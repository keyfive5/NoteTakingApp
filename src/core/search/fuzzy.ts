// Typo tolerance.
//
// Two layers, because scanning every term in the vocabulary for every keystroke
// is too slow on a phone:
//
//   1. A trigram inverted map shortlists terms that share enough 3-grams with
//      the query to have any chance of being within the edit budget.
//   2. Bounded Damerau-Levenshtein confirms the survivors, bailing out of a row
//      as soon as the whole row exceeds the budget.
//
// Transpositions are included (Damerau, not plain Levenshtein) because
// "teh"/"the" and "recieve"/"receive" are the single most common phone typos and
// plain Levenshtein charges them 2.

import { trigrams } from './tokenize.ts';

/** Edit budget for a query term. Short words get less slack, or everything matches. */
export function maxEdits(term: string): number {
  if (term.length <= 3) return 0;
  if (term.length <= 5) return 1;
  return 2;
}

/**
 * Damerau-Levenshtein distance, returning `max + 1` as soon as it is provable
 * that the true distance exceeds `max`.
 */
export function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Two rolling rows plus the row before them, which is what transposition needs.
  const n = b.length;
  let prev2: number[] = new Array(n + 1);
  let prev: number[] = new Array(n + 1);
  let cur: number[] = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    // Only the diagonal band within `max` can hold a value <= max.
    const from = Math.max(1, i - max);
    const to = Math.min(n, i + max);
    if (from > 1) cur[from - 1] = max + 1;

    let rowMin = max + 1;
    for (let j = from; j <= to; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(
        cur[j - 1] + 1, // insertion
        prev[j] + 1, // deletion
        prev[j - 1] + cost, // substitution
      );
      // Transposition of two adjacent characters.
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (to < n) cur[to + 1] = max + 1;
    if (rowMin > max) return max + 1;

    const spare = prev2;
    prev2 = prev;
    prev = cur;
    cur = spare;
  }
  return prev[n] <= max ? prev[n] : max + 1;
}

/**
 * A trigram-bucketed vocabulary. Built once per index build, queried once per
 * search term.
 */
export class FuzzyVocabulary {
  private buckets = new Map<string, string[]>();
  private terms = new Set<string>();
  /** Sorted term list, rebuilt lazily, used for binary-search prefix lookup. */
  private sorted: string[] | null = null;

  add(term: string): void {
    if (this.terms.has(term)) return;
    this.terms.add(term);
    this.sorted = null;
    for (const g of trigrams(term)) {
      const b = this.buckets.get(g);
      if (b) b.push(term);
      else this.buckets.set(g, [term]);
    }
  }

  has(term: string): boolean {
    return this.terms.has(term);
  }

  get size(): number {
    return this.terms.size;
  }

  /**
   * Terms within the edit budget of `term`, each with its distance. Excludes
   * `term` itself, which the caller has already handled as an exact match.
   */
  near(term: string, budget = maxEdits(term)): { term: string; distance: number }[] {
    if (budget <= 0) return [];
    const grams = trigrams(term);
    // A term within `budget` edits must share at least this many trigrams.
    // Each edit can destroy at most 3 of them.
    const needed = Math.max(1, grams.length - budget * 3);

    const counts = new Map<string, number>();
    for (const g of grams) {
      const bucket = this.buckets.get(g);
      if (!bucket) continue;
      for (const cand of bucket) counts.set(cand, (counts.get(cand) ?? 0) + 1);
    }

    const out: { term: string; distance: number }[] = [];
    for (const [cand, shared] of counts) {
      if (cand === term || shared < needed) continue;
      if (Math.abs(cand.length - term.length) > budget) continue;
      const d = editDistance(term, cand, budget);
      if (d <= budget) out.push({ term: cand, distance: d });
    }
    out.sort((a, b) => a.distance - b.distance || a.term.localeCompare(b.term));
    return out;
  }

  /**
   * Vocabulary terms starting with `prefix`, for search-as-you-type.
   *
   * Binary search for the start of the prefix range, then walk forward. A
   * linear scan of the whole vocabulary here was the dominant cost of a
   * one-letter query, since every keystroke re-runs this.
   */
  startingWith(prefix: string, limit = 24): string[] {
    if (!prefix) return [];
    if (this.sorted === null) this.sorted = [...this.terms].sort();
    const arr = this.sorted;

    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (arr[mid] < prefix) lo = mid + 1;
      else hi = mid;
    }

    const out: string[] = [];
    // Bound the walk: a very short prefix can cover a large slice of the
    // vocabulary, and the shortest completions are the useful ones anyway.
    const cap = limit * 8;
    for (let i = lo; i < arr.length && out.length < cap; i++) {
      const t = arr[i];
      if (!t.startsWith(prefix)) break;
      if (t.length > prefix.length) out.push(t);
    }
    out.sort((a, b) => a.length - b.length || a.localeCompare(b));
    return out.slice(0, limit);
  }
}
