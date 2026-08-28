// Core data model. Everything in src/core is pure TypeScript with no React and
// no react-native imports, so the whole engine runs under
// `node --experimental-strip-types` and is covered by scripts/test-*.mjs.

/** A note is, on disk, a single Markdown file with a small frontmatter block. */
export interface Note {
  id: string;
  title: string;
  /** Markdown body, excluding the title line. */
  body: string;
  createdAt: number;
  updatedAt: number;
  /** Tags parsed out of the body (`#work/clients`), lowercased, deduped. */
  tags: string[];
  /** Wikilink targets parsed out of the body (`[[Other note]]`), normalised. */
  links: string[];
  pinned: boolean;
  archived: boolean;
  /** Non-null once the note is in the trash; ms timestamp of deletion. */
  trashedAt: number | null;
  /** Requires device authentication to open. */
  locked: boolean;
  /** Monotonic revision, bumped on every content change. */
  rev: number;
}

export interface NoteVersion {
  rev: number;
  at: number;
  title: string;
  body: string;
}

export type SortKey = 'updated' | 'created' | 'title';

export interface Settings {
  theme: 'auto' | 'light' | 'dark';
  accent: string;
  sortKey: SortKey;
  sortAsc: boolean;
  fontScale: number;
  /** Open a blank note the moment the app launches. */
  launchIntoNewNote: boolean;
  showLineNumbers: boolean;
  editorFont: 'sans' | 'serif' | 'mono';
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'auto',
  accent: '#F2A73B',
  sortKey: 'updated',
  sortAsc: false,
  fontScale: 1,
  launchIntoNewNote: false,
  showLineNumbers: false,
  editorFont: 'sans',
};

/** How long trashed notes are retained before they are purged. */
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export function newId(rand: () => number = Math.random): string {
  // Sortable-ish: time prefix keeps ids roughly chronological, which makes the
  // on-disk file listing readable, plus enough randomness to avoid collisions.
  const t = Date.now().toString(36).padStart(9, '0');
  let r = '';
  for (let i = 0; i < 8; i++) r += Math.floor(rand() * 36).toString(36);
  return `${t}-${r}`;
}

export function emptyNote(id: string, now: number = Date.now()): Note {
  return {
    id,
    title: '',
    body: '',
    createdAt: now,
    updatedAt: now,
    tags: [],
    links: [],
    pinned: false,
    archived: false,
    trashedAt: null,
    locked: false,
    rev: 1,
  };
}

/** Words in a note body, used for the word count and reading time readouts. */
export function wordCount(text: string): number {
  const m = text.trim().match(/[\p{L}\p{N}'’_-]+/gu);
  return m ? m.length : 0;
}

export function readingMinutes(words: number): number {
  return Math.max(1, Math.round(words / 220));
}
