// Tags, wikilinks and the backlink graph.
//
// Apple Notes has no concept of a note pointing at another note. That absence is
// the single most cited reason people leave it for Obsidian or Bear. Here a note
// links to another with [[Title]], the reverse edge is derived automatically,
// and notes that link to a title that does not exist yet become an invitation to
// create it rather than a dead end.

import type { Note } from './types.ts';
import { fold } from './search/tokenize.ts';

/** `#tag`, `#nested/tag`. Not matched inside code spans or at the start of a heading. */
const TAG_RE = /(^|[\s(\[])#([\p{L}\p{N}][\p{L}\p{N}_/-]*)/gu;
/** `[[Target]]` or `[[Target|shown text]]`. */
const LINK_RE = /\[\[([^\]|\n]+)(?:\|([^\]\n]*))?\]\]/g;

/** Strip fenced and inline code so `#hashtag` in a snippet is not a tag. */
function withoutCode(body: string): string {
  return body
    .replace(/```[\s\S]*?(?:```|$)/g, (m) => ' '.repeat(m.length))
    .replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length));
}

export function extractTags(body: string): string[] {
  const text = withoutCode(body);
  const out: string[] = [];
  const seen = new Set<string>();
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(text)) !== null) {
    // A tag has to contain a letter somewhere, so "#1" and "#2026" stay plain text.
    if (!/\p{L}/u.test(m[2])) continue;
    const tag = fold(m[2]).replace(/\/+$/, '');
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }
  return out;
}

export interface WikiLink {
  /** Raw target text as written. */
  target: string;
  /** Normalised key used for matching titles. */
  key: string;
  /** Text to display, which is the alias when one was given. */
  label: string;
  start: number;
  end: number;
}

/** Title normalisation for link resolution: fold case, collapse whitespace. */
export function linkKey(title: string): string {
  return fold(title).replace(/\s+/g, ' ').trim();
}

export function extractLinks(body: string): WikiLink[] {
  const text = withoutCode(body);
  const out: WikiLink[] = [];
  LINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LINK_RE.exec(text)) !== null) {
    const target = m[1].trim();
    if (!target) continue;
    out.push({
      target,
      key: linkKey(target),
      label: (m[2] ?? '').trim() || target,
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return out;
}

/** Unique link keys, in first-seen order. */
export function extractLinkKeys(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of extractLinks(body)) {
    if (!seen.has(l.key)) {
      seen.add(l.key);
      out.push(l.key);
    }
  }
  return out;
}

export interface GraphEdge {
  from: string;
  to: string;
}

export class LinkGraph {
  /** noteId -> ids it links to */
  outgoing = new Map<string, string[]>();
  /** noteId -> ids linking to it */
  incoming = new Map<string, string[]>();
  /** link key -> note id, for resolving [[Title]] to a note */
  byKey = new Map<string, string>();
  /** Link targets that do not resolve to any note yet. */
  unresolved = new Map<string, { target: string; from: string[] }>();

  backlinkCounts(): Map<string, number> {
    const m = new Map<string, number>();
    for (const [id, list] of this.incoming) m.set(id, list.length);
    return m;
  }

  edges(): GraphEdge[] {
    const out: GraphEdge[] = [];
    for (const [from, tos] of this.outgoing) for (const to of tos) out.push({ from, to });
    return out;
  }
}

export function buildGraph(notes: Note[]): LinkGraph {
  const g = new LinkGraph();
  const live = notes.filter((n) => n.trashedAt === null);

  for (const note of live) {
    const key = linkKey(note.title);
    // First note to claim a title wins; later duplicates keep their own edges
    // but do not steal incoming links.
    if (key && !g.byKey.has(key)) g.byKey.set(key, note.id);
  }

  for (const note of live) {
    const targets: string[] = [];
    for (const key of note.links) {
      const to = g.byKey.get(key);
      if (to && to !== note.id) {
        if (!targets.includes(to)) targets.push(to);
        const inc = g.incoming.get(to);
        if (inc) {
          if (!inc.includes(note.id)) inc.push(note.id);
        } else g.incoming.set(to, [note.id]);
      } else if (!to) {
        const u = g.unresolved.get(key);
        if (u) {
          if (!u.from.includes(note.id)) u.from.push(note.id);
        } else g.unresolved.set(key, { target: key, from: [note.id] });
      }
    }
    g.outgoing.set(note.id, targets);
  }
  return g;
}

/**
 * A tag tree built from the "/" separated tag paths in use, with the number of
 * notes carrying each node counted cumulatively into its parents.
 */
export interface TagNode {
  name: string;
  path: string;
  count: number;
  children: TagNode[];
}

export function buildTagTree(notes: Note[]): TagNode[] {
  const counts = new Map<string, number>();
  for (const note of notes) {
    if (note.trashedAt !== null) continue;
    const seen = new Set<string>();
    for (const tag of note.tags) {
      // Count a note once against every ancestor of each of its tags.
      const parts = tag.split('/');
      for (let i = 1; i <= parts.length; i++) {
        const path = parts.slice(0, i).join('/');
        if (!seen.has(path)) {
          seen.add(path);
          counts.set(path, (counts.get(path) ?? 0) + 1);
        }
      }
    }
  }

  const roots: TagNode[] = [];
  const nodes = new Map<string, TagNode>();
  for (const path of [...counts.keys()].sort()) {
    const parts = path.split('/');
    const node: TagNode = {
      name: parts[parts.length - 1],
      path,
      count: counts.get(path)!,
      children: [],
    };
    nodes.set(path, node);
    if (parts.length === 1) roots.push(node);
    else nodes.get(parts.slice(0, -1).join('/'))?.children.push(node);
  }
  const byCount = (a: TagNode, b: TagNode) => b.count - a.count || a.name.localeCompare(b.name);
  const sortRec = (list: TagNode[]) => {
    list.sort(byCount);
    for (const n of list) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}
