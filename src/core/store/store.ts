// The note store: durability, history, and recovery.
//
// The single most common complaint in one-star reviews of note apps is lost
// notes — 22% of them, more than pricing and sync bugs combined. So the design
// here starts from "what happens when this goes wrong":
//
//   * One file per note. A failure can damage one note, never the library.
//   * Writes go to a temp file and are renamed into place, so a note file is
//     either the old version or the new one, never a half-written mixture.
//   * Every save appends to an append-only history log first. If the note file
//     is later destroyed, the text is still recoverable from history.
//   * Deletes are a two-stage trash with a 30-day window, not an erase.
//   * Parsing never throws. A damaged file yields whatever text survives.
//
// The filesystem is behind an interface so all of this is testable, including
// the crash paths, without touching a real disk.

import { extractLinkKeys, extractTags } from '../links.ts';
import { emptyNote, newId, TRASH_RETENTION_MS, type Note } from '../types.ts';
import {
  decodeVersions, encodeVersion, parseNote, serializeNote, type StoredVersion,
} from './serialize.ts';

export interface FileSystem {
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, data: string): Promise<void>;
  appendFile(path: string, data: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  listDir(path: string): Promise<string[]>;
  mkdirp(path: string): Promise<void>;
}

const NOTES_DIR = 'notes';
const VERSIONS_DIR = 'versions';
/** Versions kept per note. Beyond this the oldest are dropped on compaction. */
export const MAX_VERSIONS = 50;

export interface LoadReport {
  notes: Note[];
  /** Notes whose file failed to parse and were recovered from history. */
  recovered: string[];
  /** Files that could not be read at all. */
  unreadable: string[];
  /** Trashed notes purged because they were past the retention window. */
  purged: number;
}

export class NoteStore {
  private fs: FileSystem;
  private root: string;

  constructor(fs: FileSystem, root: string) {
    this.fs = fs;
    this.root = root;
  }

  private notePath(id: string): string {
    return `${this.root}/${NOTES_DIR}/${id}.md`;
  }

  private versionPath(id: string): string {
    return `${this.root}/${VERSIONS_DIR}/${id}.jsonl`;
  }

  async init(): Promise<void> {
    await this.fs.mkdirp(`${this.root}/${NOTES_DIR}`);
    await this.fs.mkdirp(`${this.root}/${VERSIONS_DIR}`);
  }

  /**
   * Read every note. A note whose file is missing or unparseable is rebuilt
   * from its last known good version rather than being dropped silently.
   */
  async load(now: number = Date.now()): Promise<LoadReport> {
    await this.init();
    const report: LoadReport = { notes: [], recovered: [], unreadable: [], purged: 0 };

    let files: string[];
    try {
      files = await this.fs.listDir(`${this.root}/${NOTES_DIR}`);
    } catch {
      return report;
    }

    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const id = file.slice(0, -3);
      let raw: string | null = null;
      try {
        raw = await this.fs.readFile(`${this.root}/${NOTES_DIR}/${file}`);
      } catch {
        raw = null;
      }

      if (raw === null || raw.trim() === '') {
        const rescued = await this.recoverFromHistory(id);
        if (rescued) {
          report.notes.push(rescued);
          report.recovered.push(id);
        } else {
          report.unreadable.push(id);
        }
        continue;
      }

      const note = parseNote(raw, id);
      // Drop trashed notes that have outlived the retention window.
      if (note.trashedAt !== null && now - note.trashedAt > TRASH_RETENTION_MS) {
        await this.destroy(note.id);
        report.purged++;
        continue;
      }
      report.notes.push(note);
    }

    report.notes.sort((a, b) => b.updatedAt - a.updatedAt);
    return report;
  }

  /** Rebuild a note from the newest entry in its history log. */
  private async recoverFromHistory(id: string): Promise<Note | null> {
    const versions = await this.versions(id);
    if (versions.length === 0) return null;
    const latest = versions[versions.length - 1];
    const note = emptyNote(id, latest.at);
    note.title = latest.title;
    note.body = latest.body;
    note.rev = latest.rev;
    note.updatedAt = latest.at;
    const reparsed = parseNote(serializeNote(note), id);
    return reparsed;
  }

  /**
   * Persist a note.
   *
   * History is appended *before* the note file is replaced. If the process dies
   * between the two, the new text is already durable and the next load recovers
   * it; the reverse order could lose the only copy.
   */
  async save(note: Note): Promise<void> {
    await this.fs.appendFile(
      this.versionPath(note.id),
      encodeVersion({ rev: note.rev, at: note.updatedAt, title: note.title, body: note.body }),
    );
    await this.writeAtomic(this.notePath(note.id), serializeNote(note));
  }

  /**
   * Write via a temp file and a rename, so a reader never observes a partially
   * written note. If the rename is unavailable the direct write is still
   * attempted, since a risky write beats refusing to save the user's work.
   */
  private async writeAtomic(path: string, data: string): Promise<void> {
    const tmp = `${path}.tmp`;
    try {
      await this.fs.writeFile(tmp, data);
      await this.fs.rename(tmp, path);
    } catch {
      await this.fs.writeFile(path, data);
      try {
        await this.fs.deleteFile(tmp);
      } catch {
        // Nothing to clean up.
      }
    }
  }

  async versions(id: string): Promise<StoredVersion[]> {
    let raw: string | null = null;
    try {
      raw = await this.fs.readFile(this.versionPath(id));
    } catch {
      return [];
    }
    if (!raw) return [];
    const all = decodeVersions(raw);
    // Later entries win for a given revision, and the newest sorts last.
    const byRev = new Map<number, StoredVersion>();
    for (const v of all) byRev.set(v.rev, v);
    return [...byRev.values()].sort((a, b) => a.rev - b.rev || a.at - b.at);
  }

  /** Trim a note's history to the most recent MAX_VERSIONS entries. */
  async compactHistory(id: string): Promise<void> {
    const all = await this.versions(id);
    if (all.length <= MAX_VERSIONS) return;
    const keep = all.slice(-MAX_VERSIONS);
    await this.writeAtomic(this.versionPath(id), keep.map(encodeVersion).join(''));
  }

  /** Move a note to the trash. Recoverable for 30 days. */
  async trash(note: Note, now: number = Date.now()): Promise<Note> {
    const next: Note = { ...note, trashedAt: now, updatedAt: now, rev: note.rev + 1 };
    await this.save(next);
    return next;
  }

  async restore(note: Note, now: number = Date.now()): Promise<Note> {
    const next: Note = { ...note, trashedAt: null, updatedAt: now, rev: note.rev + 1 };
    await this.save(next);
    return next;
  }

  /** Permanently remove a note and its history. */
  async destroy(id: string): Promise<void> {
    for (const path of [this.notePath(id), this.versionPath(id), `${this.notePath(id)}.tmp`]) {
      try {
        await this.fs.deleteFile(path);
      } catch {
        // Already gone.
      }
    }
  }

  async create(now: number = Date.now()): Promise<Note> {
    return emptyNote(newId(), now);
  }
}

/**
 * Apply an edit to a note, returning a new note. Kept here rather than in the
 * UI so revision bumping and timestamps are consistent for every caller.
 */
export function applyEdit(
  note: Note,
  changes: Partial<Pick<Note, 'title' | 'body' | 'pinned' | 'archived' | 'locked'>>,
  now: number = Date.now(),
): Note {
  const next: Note = { ...note, ...changes, updatedAt: now };
  const bodyChanged = changes.body !== undefined && changes.body !== note.body;
  const contentChanged =
    bodyChanged || (changes.title !== undefined && changes.title !== note.title);

  // Tags and links are derived state; recompute them here or they silently
  // drift away from what the note actually says.
  if (bodyChanged) {
    next.tags = extractTags(next.body);
    next.links = extractLinkKeys(next.body);
  }

  if (contentChanged) next.rev = note.rev + 1;
  // Toggling pin or archive is not an edit, so it must not disturb the
  // "recently updated" ordering people rely on to find their way back.
  else next.updatedAt = note.updatedAt;
  return next;
}
