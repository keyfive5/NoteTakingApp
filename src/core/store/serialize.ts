// On-disk format.
//
// One note is one Markdown file with a small YAML-ish frontmatter header. The
// point of that choice is ownership: the file the app writes is the same file a
// person can read, back up, diff, or open in any other editor twenty years from
// now. Nothing about a note lives only inside a proprietary database.
//
// Parsing is deliberately forgiving. A note file with a mangled header still
// yields its text, because losing formatting is recoverable and losing writing
// is not.

import { extractLinkKeys, extractTags } from '../links.ts';
import { emptyNote, type Note } from '../types.ts';

const DELIM = '---';

function escapeValue(v: string): string {
  // Only the title can contain arbitrary text; keep it on one line.
  return v.replace(/\r?\n/g, ' ').trim();
}

export function serializeNote(note: Note): string {
  const head = [
    DELIM,
    `id: ${note.id}`,
    `title: ${escapeValue(note.title)}`,
    `created: ${note.createdAt}`,
    `updated: ${note.updatedAt}`,
    `rev: ${note.rev}`,
    `pinned: ${note.pinned}`,
    `archived: ${note.archived}`,
    `locked: ${note.locked}`,
    `trashed: ${note.trashedAt ?? ''}`,
    DELIM,
    '',
  ].join('\n');
  return head + note.body;
}

function toBool(v: string | undefined): boolean {
  return v === 'true';
}

function toNum(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Parse a note file. `id` is used when the header is missing or unreadable, so
 * a damaged header can never orphan the text.
 */
export function parseNote(raw: string, id: string): Note {
  const note = emptyNote(id);

  let body = raw;
  if (raw.startsWith(DELIM)) {
    const end = raw.indexOf(`\n${DELIM}`, DELIM.length);
    if (end >= 0) {
      const header = raw.slice(DELIM.length + 1, end);
      body = raw.slice(end + DELIM.length + 2);
      // A single leading newline after the closing delimiter is separator, not content.
      if (body.startsWith('\n')) body = body.slice(1);

      const fields = new Map<string, string>();
      for (const line of header.split('\n')) {
        const colon = line.indexOf(':');
        if (colon > 0) fields.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
      }
      note.id = fields.get('id') || id;
      note.title = fields.get('title') ?? '';
      note.createdAt = toNum(fields.get('created'), note.createdAt);
      note.updatedAt = toNum(fields.get('updated'), note.createdAt);
      note.rev = toNum(fields.get('rev'), 1);
      note.pinned = toBool(fields.get('pinned'));
      note.archived = toBool(fields.get('archived'));
      note.locked = toBool(fields.get('locked'));
      const trashed = fields.get('trashed');
      note.trashedAt = trashed ? toNum(trashed, 0) || null : null;
    }
  }

  note.body = body;
  // Tags and links are always derived from the text rather than stored, so they
  // can never drift out of sync with what the note actually says.
  note.tags = extractTags(body);
  note.links = extractLinkKeys(body);
  return note;
}

/** A clean Markdown rendering for export and sharing, with no frontmatter. */
export function exportNote(note: Note): string {
  const title = note.title.trim();
  if (!title) return note.body;
  // Avoid doubling the title when the body already opens with it as a heading.
  const firstLine = note.body.split('\n', 1)[0].replace(/^#{1,6}\s+/, '').trim();
  if (firstLine.toLowerCase() === title.toLowerCase()) return note.body;
  return `# ${title}\n\n${note.body}`;
}

/** A filesystem-safe filename derived from a note's title, for export. */
export function exportFilename(note: Note, taken = new Set<string>()): string {
  const base =
    note.title
      // Replace unsafe characters with a space rather than deleting them, so
      // "Kyoto/2026" exports as "Kyoto 2026" and not "Kyoto2026".
      .replace(/[\\/:*?"<>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60) || 'Untitled';
  let name = `${base}.md`;
  let n = 2;
  while (taken.has(name.toLowerCase())) name = `${base} ${n++}.md`;
  taken.add(name.toLowerCase());
  return name;
}

// ---------------------------------------------------------------------------
// Version history
// ---------------------------------------------------------------------------

export interface StoredVersion {
  rev: number;
  at: number;
  title: string;
  body: string;
}

/**
 * Versions are stored as one JSON object per line, appended.
 *
 * Append-only is the whole safety argument: adding a version never rewrites
 * existing bytes, so a crash mid-write can only ever corrupt the final line,
 * which the reader drops. Earlier history is physically untouchable.
 */
export function encodeVersion(v: StoredVersion): string {
  return JSON.stringify(v) + '\n';
}

export function decodeVersions(raw: string): StoredVersion[] {
  const out: StoredVersion[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line);
      if (typeof v?.rev === 'number' && typeof v?.body === 'string') out.push(v as StoredVersion);
    } catch {
      // A truncated final line from an interrupted write. Everything before it
      // is still valid, which is exactly the property append-only buys.
    }
  }
  return out;
}
