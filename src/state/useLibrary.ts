// The library: every note, the search index, the link graph, and persistence.
//
// One hook owns all of it so there is a single place where "a note changed"
// means the same thing to storage, search and links. The index is updated
// incrementally rather than rebuilt, which is what keeps a keystroke cheap in a
// library of thousands.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildIndex, removeDoc, search as runSearch, SearchIndex, upsertDoc,
  type SearchResult,
} from '../core/search/engine.ts';
import { buildGraph, buildTagTree, type LinkGraph, type TagNode } from '../core/links.ts';
import { applyEdit, NoteStore } from '../core/store/store.ts';
import { DEFAULT_SETTINGS, type Note, type Settings, type SortKey } from '../core/types.ts';
import { getFileSystem } from '../platform/fs.ts';

/** How long after the last keystroke a note is written to disk. */
const SAVE_DEBOUNCE_MS = 600;

export interface Library {
  ready: boolean;
  notes: Map<string, Note>;
  index: SearchIndex;
  graph: LinkGraph;
  tags: TagNode[];
  settings: Settings;
  /** Notes rebuilt from history because their file was damaged. */
  recovered: string[];
  counts: { active: number; archived: number; trashed: number };

  create(seed?: Partial<Note>): Note;
  update(id: string, changes: Partial<Pick<Note, 'title' | 'body' | 'pinned' | 'archived' | 'locked'>>): void;
  trash(id: string): void;
  restore(id: string): void;
  destroy(id: string): void;
  emptyTrash(): void;
  setSettings(next: Partial<Settings>): void;
  search(query: string, opts?: { scope?: 'active' | 'archive' | 'trash' | 'all'; limit?: number }): SearchResult[];
  /** Resolve a [[wikilink]] key to an existing note, if there is one. */
  resolveLink(key: string): Note | undefined;
  /** Titles for the [[link]] autocomplete. */
  titleSuggestions(query: string, limit?: number): Note[];
  flush(): Promise<void>;
}

const SETTINGS_PATH = 'settings.json';

export function useLibrary(): Library {
  const [notes, setNotes] = useState<Map<string, Note>>(() => new Map());
  const [ready, setReady] = useState(false);
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS);
  const [recovered, setRecovered] = useState<string[]>([]);
  /** Bumped whenever the index changes, so memos depending on it recompute. */
  const [revision, setRevision] = useState(0);

  const storeRef = useRef<NoteStore | null>(null);
  const indexRef = useRef<SearchIndex>(new SearchIndex());
  const pending = useRef(new Map<string, Note>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (!storeRef.current) {
    const { fs, root } = getFileSystem();
    storeRef.current = new NoteStore(fs, root);
  }

  // Initial load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const store = storeRef.current!;
      const report = await store.load();
      if (cancelled) return;

      const map = new Map(report.notes.map((n) => [n.id, n]));
      const graph = buildGraph(report.notes);
      indexRef.current = buildIndex(report.notes, graph.backlinkCounts());
      setNotes(map);
      setRecovered(report.recovered);

      try {
        const { fs, root } = getFileSystem();
        const raw = await fs.readFile(`${root}/${SETTINGS_PATH}`);
        if (raw) setSettingsState({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) });
      } catch {
        // Settings are a convenience; defaults are always acceptable.
      }
      setReady(true);
      setRevision((r) => r + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Queue a note for writing, coalescing rapid edits into one save. */
  const queueSave = useCallback((note: Note) => {
    pending.current.set(note.id, note);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      const batch = [...pending.current.values()];
      pending.current.clear();
      const store = storeRef.current!;
      (async () => {
        for (const n of batch) {
          try {
            await store.save(n);
            if (n.rev % 25 === 0) await store.compactHistory(n.id);
          } catch {
            // Put it back so the next tick tries again rather than dropping it.
            pending.current.set(n.id, n);
          }
        }
      })();
    }, SAVE_DEBOUNCE_MS);
  }, []);

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const batch = [...pending.current.values()];
    pending.current.clear();
    for (const n of batch) {
      try {
        await storeRef.current!.save(n);
      } catch {
        // Nothing more to try; the in-memory copy is still correct.
      }
    }
  }, []);

  // Write anything outstanding when the app goes away.
  useEffect(() => {
    return () => {
      void flush();
    };
  }, [flush]);

  const commit = useCallback(
    (next: Note) => {
      setNotes((prev) => {
        const map = new Map(prev);
        map.set(next.id, next);
        return map;
      });
      upsertDoc(indexRef.current, next);
      setRevision((r) => r + 1);
      queueSave(next);
    },
    [queueSave],
  );

  const create = useCallback(
    (seed?: Partial<Note>) => {
      const now = Date.now();
      const note: Note = {
        id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
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
        ...seed,
      };
      commit(note);
      return note;
    },
    [commit],
  );

  const update = useCallback(
    (id: string, changes: Partial<Pick<Note, 'title' | 'body' | 'pinned' | 'archived' | 'locked'>>) => {
      setNotes((prev) => {
        const current = prev.get(id);
        if (!current) return prev;
        const next = applyEdit(current, changes);
        if (next === current) return prev;
        const map = new Map(prev);
        map.set(id, next);
        upsertDoc(indexRef.current, next);
        queueSave(next);
        return map;
      });
      setRevision((r) => r + 1);
    },
    [queueSave],
  );

  const setFlag = useCallback(
    (id: string, mutate: (n: Note) => Note) => {
      setNotes((prev) => {
        const current = prev.get(id);
        if (!current) return prev;
        const next = mutate(current);
        const map = new Map(prev);
        map.set(id, next);
        upsertDoc(indexRef.current, next);
        queueSave(next);
        return map;
      });
      setRevision((r) => r + 1);
    },
    [queueSave],
  );

  const trash = useCallback(
    (id: string) => setFlag(id, (n) => ({ ...n, trashedAt: Date.now(), rev: n.rev + 1 })),
    [setFlag],
  );

  const restore = useCallback(
    (id: string) => setFlag(id, (n) => ({ ...n, trashedAt: null, rev: n.rev + 1 })),
    [setFlag],
  );

  const destroy = useCallback((id: string) => {
    setNotes((prev) => {
      const map = new Map(prev);
      map.delete(id);
      return map;
    });
    removeDoc(indexRef.current, id);
    setRevision((r) => r + 1);
    void storeRef.current!.destroy(id);
  }, []);

  const emptyTrash = useCallback(() => {
    setNotes((prev) => {
      const map = new Map(prev);
      for (const [id, n] of prev) {
        if (n.trashedAt !== null) {
          map.delete(id);
          removeDoc(indexRef.current, id);
          void storeRef.current!.destroy(id);
        }
      }
      return map;
    });
    setRevision((r) => r + 1);
  }, []);

  const setSettings = useCallback((partial: Partial<Settings>) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...partial };
      const { fs, root } = getFileSystem();
      void fs.writeFile(`${root}/${SETTINGS_PATH}`, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const list = useMemo(() => [...notes.values()], [notes]);

  const graph = useMemo(() => buildGraph(list), [list]);
  const tags = useMemo(() => buildTagTree(list), [list]);

  const counts = useMemo(() => {
    let active = 0;
    let archived = 0;
    let trashed = 0;
    for (const n of list) {
      if (n.trashedAt !== null) trashed++;
      else if (n.archived) archived++;
      else active++;
    }
    return { active, archived, trashed };
  }, [list]);

  const search = useCallback(
    (query: string, opts?: { scope?: 'active' | 'archive' | 'trash' | 'all'; limit?: number }) =>
      runSearch(indexRef.current, notes, query, opts),
    // `revision` is not read here, but a changed index must invalidate callers'
    // memos, so it stays in the dependency list deliberately.
    [notes, revision],
  );

  const resolveLink = useCallback(
    (key: string) => {
      const id = graph.byKey.get(key);
      return id ? notes.get(id) : undefined;
    },
    [graph, notes],
  );

  const titleSuggestions = useCallback(
    (query: string, limit = 8) => {
      const q = query.trim().toLowerCase();
      const candidates = list.filter((n) => n.trashedAt === null && n.title.trim() !== '');
      const scored = candidates
        .map((n) => {
          const t = n.title.toLowerCase();
          if (!q) return { n, rank: 2 };
          if (t.startsWith(q)) return { n, rank: 0 };
          if (t.includes(q)) return { n, rank: 1 };
          return null;
        })
        .filter((x): x is { n: Note; rank: number } => x !== null);
      scored.sort((a, b) => a.rank - b.rank || b.n.updatedAt - a.n.updatedAt);
      return scored.slice(0, limit).map((s) => s.n);
    },
    [list],
  );

  return {
    ready,
    notes,
    index: indexRef.current,
    graph,
    tags,
    settings,
    recovered,
    counts,
    create,
    update,
    trash,
    restore,
    destroy,
    emptyTrash,
    setSettings,
    search,
    resolveLink,
    titleSuggestions,
    flush,
  };
}

/** Order a result list for display: pinned first, then by the chosen key. */
export function sortNotes(notes: Note[], key: SortKey, ascending: boolean): Note[] {
  const dir = ascending ? 1 : -1;
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (key === 'title') {
      return a.title.localeCompare(b.title) * dir;
    }
    const av = key === 'created' ? a.createdAt : a.updatedAt;
    const bv = key === 'created' ? b.createdAt : b.updatedAt;
    return (av - bv) * dir;
  });
}
