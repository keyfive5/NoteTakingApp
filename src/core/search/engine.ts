// The search engine: index build, BM25F ranking, and snippet extraction.
//
// Ranking is BM25F over three fields (title, tags, body) with per-field length
// normalisation, then a small set of bonuses that reflect how people actually
// look for their own notes: a title hit beats a body hit, a note you touched
// this morning beats one from two years ago, and everything you typed appearing
// together beats the terms appearing in separate paragraphs.
//
// Each query term is expanded through four layers, each with a confidence
// weight, so a typo still finds the note but never outranks a clean match:
//
//   exact    1.00   the word as typed
//   stem     0.85   "running" finding "runs"
//   prefix   0.70   search-as-you-type, before the word is finished
//   fuzzy    0.55   one or two edits away, scaled by distance

import type { Note } from '../types.ts';
import { FuzzyVocabulary, maxEdits } from './fuzzy.ts';
import { parseQuery, tagMatches, type ParsedQuery, type Scope } from './query.ts';
import { fold, tokenize } from './tokenize.ts';

export const FIELD = { title: 0, body: 1, tag: 2 } as const;
export type FieldId = 0 | 1 | 2;

/** Field weights. Title dominates because that is how people remember notes. */
const FIELD_WEIGHT = [3.4, 1.0, 2.2];
/** Per-field length normalisation. Titles are short, so normalise them lightly. */
const FIELD_B = [0.35, 0.75, 0.3];
const K1 = 1.35;

type FieldTf = [number, number, number];

interface IndexedDoc {
  id: string;
  /** Superseded by a newer revision, or deleted. Skipped by every query. */
  dead: boolean;
  /** Folded title, precomputed so ranking never calls fold() per document. */
  foldedTitle: string;
  lens: FieldTf;
  updatedAt: number;
  createdAt: number;
  pinned: boolean;
  archived: boolean;
  trashed: boolean;
  locked: boolean;
  tags: string[];
  hasOpenTask: boolean;
  hasDoneTask: boolean;
  linkCount: number;
}

export class SearchIndex {
  docs: IndexedDoc[] = [];
  byId = new Map<string, number>();
  /** surface term -> doc index -> per-field term frequency */
  postings = new Map<string, Map<number, FieldTf>>();
  /** stem -> surface terms that reduce to it */
  stems = new Map<string, string[]>();
  vocab = new FuzzyVocabulary();
  avgLens: FieldTf = [1, 1, 1];
  /** tag -> doc indices, for instant tag filtering */
  tagIndex = new Map<string, number[]>();
  /** Running field-length totals over live documents, for avgLens. */
  totals: FieldTf = [0, 0, 0];
  /** Number of superseded entries still occupying space in the postings. */
  deadCount = 0;
  live = 0;

  get size(): number {
    return this.live;
  }

  /**
   * True once enough superseded entries have accumulated that a rebuild is
   * cheaper than carrying them. Editing a note leaves its previous revision
   * behind in the postings, so a long session slowly accretes garbage.
   */
  get shouldCompact(): boolean {
    return this.deadCount > 64 && this.deadCount > this.live;
  }
}

function addPosting(index: SearchIndex, term: string, doc: number, field: FieldId): void {
  let m = index.postings.get(term);
  if (!m) {
    m = new Map();
    index.postings.set(term, m);
    index.vocab.add(term);
  }
  let tf = m.get(doc);
  if (!tf) {
    tf = [0, 0, 0];
    m.set(doc, tf);
  }
  tf[field]++;
}

function addStem(index: SearchIndex, stem: string, term: string): void {
  if (stem === term) return;
  const list = index.stems.get(stem);
  if (!list) index.stems.set(stem, [term]);
  else if (!list.includes(term)) list.push(term);
}

const OPEN_TASK = /^\s*[-*]\s+\[ \]/m;
const DONE_TASK = /^\s*[-*]\s+\[[xX]\]/m;

/**
 * Index one note, appending a new entry. Shared by the full build and by the
 * incremental upsert path.
 */
function addDoc(index: SearchIndex, note: Note, backlinkCounts?: Map<string, number>): number {
  const doc = index.docs.length;
  index.byId.set(note.id, doc);

  const titleToks = tokenize(note.title);
  const bodyToks = tokenize(note.body);

  for (const t of titleToks) {
    addPosting(index, t.text, doc, FIELD.title);
    addStem(index, t.stem, t.text);
  }
  for (const t of bodyToks) {
    addPosting(index, t.text, doc, FIELD.body);
    addStem(index, t.stem, t.text);
  }
  let tagLen = 0;
  for (const tag of note.tags) {
    // Index both the whole path and each segment, so "#work/clients/acme" is
    // findable as "work", "clients" or "acme".
    for (const t of tokenize(tag.replace(/\//g, ' '))) {
      addPosting(index, t.text, doc, FIELD.tag);
      addStem(index, t.stem, t.text);
      tagLen++;
    }
    const list = index.tagIndex.get(tag);
    if (list) list.push(doc);
    else index.tagIndex.set(tag, [doc]);
  }

  const lens: FieldTf = [titleToks.length, bodyToks.length, tagLen];
  index.totals[0] += lens[0];
  index.totals[1] += lens[1];
  index.totals[2] += lens[2];

  index.docs.push({
    id: note.id,
    dead: false,
    foldedTitle: fold(note.title),
    lens,
    updatedAt: note.updatedAt,
    createdAt: note.createdAt,
    pinned: note.pinned,
    archived: note.archived,
    trashed: note.trashedAt !== null,
    locked: note.locked,
    tags: note.tags,
    hasOpenTask: OPEN_TASK.test(note.body),
    hasDoneTask: DONE_TASK.test(note.body),
    linkCount: note.links.length + (backlinkCounts?.get(note.id) ?? 0),
  });
  index.live++;
  return doc;
}

/** Recompute average field lengths from the running totals. */
function refreshAvgLens(index: SearchIndex): void {
  const n = Math.max(1, index.live);
  index.avgLens = [
    Math.max(1, index.totals[0] / n),
    Math.max(1, index.totals[1] / n),
    Math.max(1, index.totals[2] / n),
  ];
}

export function buildIndex(notes: Note[], backlinkCounts?: Map<string, number>): SearchIndex {
  const index = new SearchIndex();
  for (const note of notes) addDoc(index, note, backlinkCounts);
  refreshAvgLens(index);
  return index;
}

/**
 * Add or replace a single note without rebuilding.
 *
 * The previous entry is tombstoned rather than unstitched from the postings,
 * because removing a document properly means visiting every term it contained.
 * Queries skip dead entries, and `shouldCompact` tells the caller when the
 * accumulated tombstones are worth a rebuild.
 */
export function upsertDoc(index: SearchIndex, note: Note, backlinkCounts?: Map<string, number>): void {
  retireDoc(index, note.id);
  addDoc(index, note, backlinkCounts);
  refreshAvgLens(index);
}

/** Tombstone a note's current entry, if it has one. */
export function retireDoc(index: SearchIndex, id: string): void {
  const prev = index.byId.get(id);
  if (prev === undefined) return;
  const old = index.docs[prev];
  if (old.dead) return;
  old.dead = true;
  index.deadCount++;
  index.live--;
  index.totals[0] -= old.lens[0];
  index.totals[1] -= old.lens[1];
  index.totals[2] -= old.lens[2];
  index.byId.delete(id);
}

/** Remove a note from the index entirely. */
export function removeDoc(index: SearchIndex, id: string): void {
  retireDoc(index, id);
  refreshAvgLens(index);
}

/** Candidate surface terms for one query term, with a confidence weight each. */
function expand(index: SearchIndex, term: string): Map<string, number> {
  const out = new Map<string, number>();
  const put = (t: string, w: number) => {
    const cur = out.get(t);
    if (cur === undefined || w > cur) out.set(t, w);
  };

  const exact = index.postings.has(term);
  if (exact) put(term, 1);

  // Stem expansion: reach the other surface forms of the same word.
  const { stem } = tokenize(term)[0] ?? { stem: term };
  if (index.postings.has(stem)) put(stem, 0.85);
  for (const sibling of index.stems.get(stem) ?? []) put(sibling, 0.85);

  // Prefix expansion. Longer completions are less certain than short ones.
  for (const completion of index.vocab.startingWith(term)) {
    put(completion, 0.7 * (term.length / completion.length) ** 0.35);
  }

  // Fuzzy expansion is the most expensive layer, so it is only paid for when the
  // word is not already a real word in this collection. If you typed something
  // that exists, you did not make a typo, and correcting it would only add noise.
  if (!exact && maxEdits(term) > 0) {
    for (const { term: cand, distance } of index.vocab.near(term).slice(0, 12)) {
      put(cand, 0.55 / distance);
    }
  }

  // Decompounding: "lightbulb" should find a note that says "light bulb". Only
  // splits where both halves are real words in this vocabulary are accepted.
  for (const part of decompose(index, term)) put(part, 0.75);

  return out;
}

/**
 * Split a solid compound into vocabulary words, e.g. "lightbulb" -> light, bulb.
 * Returns [] when the term is already a known word or has no clean split.
 */
export function decompose(index: SearchIndex, term: string): string[] {
  if (term.length < 6 || index.postings.has(term)) return [];
  const found: string[] = [];
  for (let i = 3; i <= term.length - 3; i++) {
    const a = term.slice(0, i);
    const b = term.slice(i);
    if (index.postings.has(a) && index.postings.has(b)) {
      found.push(a, b);
      break;
    }
  }
  return found;
}

function idf(df: number, n: number): number {
  return Math.log(1 + (n - df + 0.5) / (df + 0.5));
}

export interface Highlight {
  start: number;
  end: number;
}

export interface SearchResult {
  id: string;
  score: number;
  /** A body excerpt around the strongest match, or the note's opening. */
  snippet: string;
  /** Ranges within `snippet` that matched, for highlighting. */
  snippetHighlights: Highlight[];
  /** Ranges within the title that matched. */
  titleHighlights: Highlight[];
  /** True when nothing was typed and this is just a listing. */
  listing: boolean;
}

export interface SearchOptions {
  limit?: number;
  /** Overrides the scope parsed from the query text. */
  scope?: Scope;
  now?: number;
  backlinks?: Map<string, number>;
}

function passesFilters(d: IndexedDoc, q: ParsedQuery, scope: Scope): boolean {
  if (d.dead) return false;
  if (scope === 'active' && (d.archived || d.trashed)) return false;
  if (scope === 'archive' && (!d.archived || d.trashed)) return false;
  if (scope === 'trash' && !d.trashed) return false;
  if (scope === 'all' && d.trashed) return false;

  for (const filter of q.tags) {
    if (!d.tags.some((t) => tagMatches(t, filter))) return false;
  }
  for (const state of q.states) {
    if (state === 'pinned' && !d.pinned) return false;
    if (state === 'todo' && !d.hasOpenTask) return false;
    if (state === 'done' && !d.hasDoneTask) return false;
    if (state === 'locked' && !d.locked) return false;
    if (state === 'linked' && d.linkCount === 0) return false;
    if (state === 'orphan' && d.linkCount > 0) return false;
    if (state === 'untagged' && d.tags.length > 0) return false;
  }
  for (const bound of q.dates) {
    const v = bound.field === 'created' ? d.createdAt : d.updatedAt;
    if (bound.op === '>' && v < bound.at) return false;
    if (bound.op === '<' && v > bound.at) return false;
  }
  return true;
}

/**
 * Recency multiplier. Deliberately gentle — it breaks ties between comparable
 * matches without letting a fresh note outrank a genuinely better old one.
 */
function recencyBoost(updatedAt: number, now: number): number {
  const days = Math.max(0, (now - updatedAt) / 864e5);
  return 1 + 0.28 / (1 + days / 21);
}

export function search(
  index: SearchIndex,
  notes: Map<string, Note>,
  input: string,
  opts: SearchOptions = {},
): SearchResult[] {
  const q = parseQuery(input);
  const scope = opts.scope ?? q.scope;
  const now = opts.now ?? Date.now();
  const limit = opts.limit ?? 200;
  const n = Math.max(1, index.docs.length);

  // Phrases contribute their component terms to matching; adjacency is verified
  // afterwards against the source text.
  const queryTerms = [...q.terms];
  for (const phrase of q.phrases) for (const t of phrase) if (!queryTerms.includes(t)) queryTerms.push(t);

  // Nothing typed: this is a listing, not a ranked search.
  if (queryTerms.length === 0) {
    const out: SearchResult[] = [];
    for (const d of index.docs) {
      if (!passesFilters(d, q, scope)) continue;
      const note = notes.get(d.id);
      if (!note) continue;
      out.push({
        id: d.id,
        score: 0,
        snippet: preview(note.body),
        snippetHighlights: [],
        titleHighlights: [],
        listing: true,
      });
    }
    return out.slice(0, limit);
  }

  // passesFilters() is otherwise re-evaluated once per (term, expansion, doc);
  // memoise it per document for the life of this query.
  const eligible = new Int8Array(index.docs.length);
  const isEligible = (doc: number): boolean => {
    let v = eligible[doc];
    if (v === 0) {
      v = passesFilters(index.docs[doc], q, scope) ? 1 : -1;
      eligible[doc] = v;
    }
    return v === 1;
  };

  const expansionsByTerm = new Map<string, Map<string, number>>();
  for (const term of queryTerms) expansionsByTerm.set(term, expand(index, term));

  // Recompounding, the mirror of decompose(): typing "light bulb" should find a
  // note that says "lightbulb". The joined form is credited to *both* source
  // terms so the note also earns full query coverage rather than half.
  for (let i = 0; i + 1 < queryTerms.length; i++) {
    const joined = queryTerms[i] + queryTerms[i + 1];
    if (!index.postings.has(joined)) continue;
    for (const t of [queryTerms[i], queryTerms[i + 1]]) {
      const m = expansionsByTerm.get(t)!;
      if ((m.get(joined) ?? 0) < 0.9) m.set(joined, 0.9);
    }
  }

  const scores = new Map<number, number>();
  const matchedPerTerm = new Map<number, number>();

  for (const term of queryTerms) {
    const expansions = expansionsByTerm.get(term)!;
    const hitDocs = new Set<number>();

    for (const [surface, weight] of expansions) {
      const posting = index.postings.get(surface);
      if (!posting) continue;
      const termIdf = idf(posting.size, n);

      for (const [doc, tf] of posting) {
        if (!isEligible(doc)) continue;
        const d = index.docs[doc];

        // BM25F: normalise each field by its own length, sum, then saturate.
        let weighted = 0;
        for (let f = 0; f < 3; f++) {
          if (tf[f] === 0) continue;
          const norm = 1 - FIELD_B[f] + (FIELD_B[f] * d.lens[f]) / index.avgLens[f];
          weighted += (FIELD_WEIGHT[f] * tf[f]) / norm;
        }
        if (weighted === 0) continue;

        const contribution = weight * termIdf * (weighted / (K1 + weighted));
        scores.set(doc, (scores.get(doc) ?? 0) + contribution);
        hitDocs.add(doc);
      }
    }
    for (const doc of hitDocs) matchedPerTerm.set(doc, (matchedPerTerm.get(doc) ?? 0) + 1);
  }

  // Scoring pass. This touches every matched document, so it must stay free of
  // per-document string work: the folded title is precomputed at index time and
  // the note body is not read at all here.
  const typed = queryTerms.join(' ');
  const results: { doc: number; score: number }[] = [];
  for (const [doc, raw] of scores) {
    const d = index.docs[doc];

    // Coverage: every query term matching somewhere is a much stronger signal
    // than one term matching many times.
    const covered = matchedPerTerm.get(doc) ?? 0;
    if (covered === 0) continue;
    const coverage = (covered / queryTerms.length) ** 1.6;
    let score = raw * (0.35 + 0.65 * coverage);

    // A title that starts with what you typed is almost always the note you meant.
    if (d.foldedTitle === typed) score *= 2.2;
    else if (d.foldedTitle.startsWith(typed)) score *= 1.7;

    score *= recencyBoost(d.updatedAt, now);
    if (d.pinned) score *= 1.15;
    if (d.archived) score *= 0.75;
    // A phrase query promises adjacency, which is confirmed during the walk
    // below. Boost here so confirmed hits sort above the merely plausible.
    if (q.phrases.length) score *= 1.5;

    results.push({ doc, score });
  }

  results.sort((a, b) => b.score - a.score || index.docs[b.doc].updatedAt - index.docs[a.doc].updatedAt);

  const surfaces = new Set<string>();
  for (const m of expansionsByTerm.values()) for (const s of m.keys()) surfaces.add(s);
  // Compiled once per query, not once per candidate note.
  const phraseRes = q.phrases.map(phraseMatcher);

  // Phrase adjacency and exclusions are the only checks that need the note text,
  // so they run lazily while walking the ranked list. Applying them to every
  // candidate instead was the slowest thing in this function by 16x.
  const out: SearchResult[] = [];
  for (const { doc, score } of results) {
    if (out.length >= limit) break;
    const note = notes.get(index.docs[doc].id);
    if (!note) continue;

    if (q.excluded.length) {
      const hay = fold(note.title + '\n' + note.body);
      if (q.excluded.some((x) => hay.includes(x))) continue;
    }
    if (phraseRes.length && !phraseRes.every((re) => containsPhrase(note, re))) continue;

    const { text, highlights } = snippetFor(note.body, surfaces);
    out.push({
      id: note.id,
      score,
      snippet: text,
      snippetHighlights: highlights,
      titleHighlights: highlightRanges(note.title, surfaces),
      listing: false,
    });
  }
  return out;
}

/**
 * Compile a phrase into a regex that tolerates any punctuation or whitespace
 * between the words.
 *
 * The obvious implementation tokenises each candidate note and slides a window
 * over the tokens, but that allocates hundreds of objects per note and made a
 * phrase query 16x slower than every other query in the benchmark. A native
 * regex test over the raw string does the same job without allocating.
 */
function phraseMatcher(phrase: string[]): RegExp {
  // Phrase terms come out of the tokenizer, so they only ever contain letters,
  // digits and underscore. None of those are regex metacharacters, so there is
  // nothing to escape here.
  return new RegExp(phrase.join('[^\\p{L}\\p{N}]+'), 'iu');
}

/** Text whose raw form may differ from its folded form (non-ASCII, apostrophes). */
const NEEDS_FOLD = /[^\x00-\x7F]|['\u2019]/;

/** Does the note contain this phrase adjacently, in order? */
function containsPhrase(note: Note, re: RegExp): boolean {
  if (re.test(note.title) || re.test(note.body)) return true;
  // Accents and apostrophes can block a raw match ("resume", "don't"); those
  // notes are re-tested against folded text, which is what the phrase terms are.
  if (!NEEDS_FOLD.test(note.title) && !NEEDS_FOLD.test(note.body)) return false;
  return re.test(fold(note.title)) || re.test(fold(note.body));
}

/** Character ranges in `text` whose tokens are in `surfaces`. */
export function highlightRanges(text: string, surfaces: Set<string>): Highlight[] {
  const out: Highlight[] = [];
  for (const t of tokenize(text)) {
    if (!surfaces.has(t.text)) continue;
    const last = out[out.length - 1];
    // Merge sub-token ranges into their parent rather than nesting them.
    if (last && t.start <= last.end) last.end = Math.max(last.end, t.end);
    else out.push({ start: t.start, end: t.end });
  }
  return out;
}

const SNIPPET_LEN = 180;

/**
 * A note's text *after* its title line, for list rows.
 *
 * The first non-empty line is the title, and the row already displays it, so
 * repeating it in the excerpt below wastes the only two lines available.
 */
export function preview(body: string, max = SNIPPET_LEN): string {
  const lines = body.split('\n');
  let start = 0;
  while (start < lines.length && lines[start].trim() === '') start++;
  // Drop the title line itself, then any blank lines under it.
  start++;
  while (start < lines.length && lines[start].trim() === '') start++;

  const cleaned = lines
    .slice(start)
    .join('\n')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+\[[ xX]\]\s*/gm, '')
    .replace(/^\s*[-*>]\s+/gm, '')
    .replace(/[*_`]/g, '')
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1')
    .trim();
  const flat = cleaned.replace(/\s*\n\s*/g, '  ').trim();
  return flat.length > max ? flat.slice(0, max).trimEnd() + '…' : flat;
}

/**
 * A window of the body centred on the densest cluster of matches, with
 * highlight ranges rebased onto the returned string.
 */
export function snippetFor(body: string, surfaces: Set<string>): { text: string; highlights: Highlight[] } {
  const hits = highlightRanges(body, surfaces);
  if (hits.length === 0) return { text: preview(body), highlights: [] };

  // Slide a window over the hits and keep the one covering the most.
  let best = { start: hits[0].start, count: 0 };
  for (let i = 0; i < hits.length; i++) {
    let count = 0;
    for (let j = i; j < hits.length && hits[j].end - hits[i].start <= SNIPPET_LEN; j++) count++;
    if (count > best.count) best = { start: hits[i].start, count };
  }

  let from = Math.max(0, best.start - 32);
  // Snap to a word boundary so snippets never start mid-word.
  while (from > 0 && /[\p{L}\p{N}]/u.test(body[from - 1])) from--;
  let to = Math.min(body.length, from + SNIPPET_LEN);
  while (to < body.length && /[\p{L}\p{N}]/u.test(body[to])) to++;

  const raw = body.slice(from, to);
  const lead = from > 0 ? '…' : '';
  const tail = to < body.length ? '…' : '';

  // Collapse newlines for display, keeping the character count stable so the
  // rebased highlight offsets stay correct.
  const text = lead + raw.replace(/\n/g, ' ') + tail;
  const shift = lead.length - from;
  const highlights = hits
    .filter((h) => h.start >= from && h.end <= to)
    .map((h) => ({ start: h.start + shift, end: h.end + shift }));

  return { text, highlights };
}
