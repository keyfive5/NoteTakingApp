// Query language.
//
// Plain words are the common case and must never require syntax. On top of that
// there are a few operators that people reach for once they have thousands of
// notes:
//
//   groceries              free text
//   "team offsite"         exact phrase
//   tag:work/clients       tag filter, matches nested children too
//   is:pinned is:todo      state filters (pinned, todo, done, locked, linked)
//   in:archive in:trash    scope; default is everything except archive+trash
//   -draft                 exclude
//   created:>2026-01-01    date bounds on created/updated
//
// Anything that does not parse as an operator falls back to being a search
// term, so a stray colon never makes the query fail.

export type StateFilter = 'pinned' | 'todo' | 'done' | 'locked' | 'linked' | 'orphan' | 'untagged';
export type Scope = 'active' | 'archive' | 'trash' | 'all';

export interface DateBound {
  field: 'created' | 'updated';
  op: '>' | '<';
  at: number;
}

export interface ParsedQuery {
  /** Free-text terms, folded and lowercased. */
  terms: string[];
  /** Quoted phrases, each already split into its component terms. */
  phrases: string[][];
  /** Terms that must not appear. */
  excluded: string[];
  tags: string[];
  states: StateFilter[];
  scope: Scope;
  dates: DateBound[];
  /** True when nothing at all was typed. */
  empty: boolean;
  /** True when the query has filters but no text to rank by. */
  filtersOnly: boolean;
}

import { fold, tokenize } from './tokenize.ts';

const STATES: StateFilter[] = ['pinned', 'todo', 'done', 'locked', 'linked', 'orphan', 'untagged'];
const SCOPES: Scope[] = ['active', 'archive', 'trash', 'all'];

/** Split on whitespace but keep "quoted runs" together. */
function lex(input: string): { text: string; quoted: boolean }[] {
  const out: { text: string; quoted: boolean }[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (c === ' ' || c === '\t' || c === '\n') {
      i++;
      continue;
    }
    if (c === '"' || c === '“') {
      const close = input.slice(i + 1).search(/["”]/);
      if (close >= 0) {
        out.push({ text: input.slice(i + 1, i + 1 + close), quoted: true });
        i += close + 2;
        continue;
      }
      // Unterminated quote: treat the rest as a phrase so search-as-you-type
      // behaves sensibly while the closing quote is still being typed.
      out.push({ text: input.slice(i + 1), quoted: true });
      break;
    }
    let j = i;
    let depth = 0;
    while (j < input.length && (depth > 0 || !/\s/.test(input[j]))) {
      if (input[j] === '"') depth = depth ? 0 : 1;
      j++;
    }
    out.push({ text: input.slice(i, j), quoted: false });
    i = j;
  }
  return out;
}

function parseDate(v: string): number | null {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(v);
  if (m) return Date.UTC(+m[1], +m[2] - 1, m[3] ? +m[3] : 1);
  const rel = /^(\d+)([dwmy])$/.exec(v);
  if (rel) {
    const n = +rel[1];
    const ms = { d: 864e5, w: 7 * 864e5, m: 30 * 864e5, y: 365 * 864e5 }[rel[2]]!;
    return Date.now() - n * ms;
  }
  if (v === 'today') return new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  if (v === 'yesterday') return new Date(new Date().setHours(0, 0, 0, 0)).getTime() - 864e5;
  return null;
}

export function parseQuery(input: string): ParsedQuery {
  const q: ParsedQuery = {
    terms: [],
    phrases: [],
    excluded: [],
    tags: [],
    states: [],
    scope: 'active',
    dates: [],
    empty: false,
    filtersOnly: false,
  };

  for (const tok of lex(input)) {
    if (tok.quoted) {
      const parts = tokenize(tok.text).map((t) => t.text);
      if (parts.length > 1) q.phrases.push(parts);
      else if (parts.length === 1) q.terms.push(parts[0]);
      continue;
    }

    let word = tok.text;
    let negated = false;
    if (word.startsWith('-') && word.length > 1) {
      negated = true;
      word = word.slice(1);
    }

    const colon = word.indexOf(':');
    if (colon > 0) {
      const key = word.slice(0, colon).toLowerCase();
      const value = word.slice(colon + 1).replace(/^["“]|["”]$/g, '');
      if (value) {
        if ((key === 'tag' || key === 't') && !negated) {
          q.tags.push(fold(value).replace(/^#/, ''));
          continue;
        }
        if (key === 'is' && STATES.includes(value.toLowerCase() as StateFilter)) {
          q.states.push(value.toLowerCase() as StateFilter);
          continue;
        }
        if (key === 'in' && SCOPES.includes(value.toLowerCase() as Scope)) {
          q.scope = value.toLowerCase() as Scope;
          continue;
        }
        if (key === 'created' || key === 'updated') {
          const op = value[0] === '<' ? '<' : '>';
          const at = parseDate(value.replace(/^[<>]/, ''));
          if (at !== null) {
            q.dates.push({ field: key, op, at });
            continue;
          }
        }
      }
    }

    if (word.startsWith('#') && word.length > 1 && !negated) {
      q.tags.push(fold(word.slice(1)));
      continue;
    }

    for (const t of tokenize(word)) {
      if (negated) q.excluded.push(t.text);
      else q.terms.push(t.text);
    }
  }

  // De-duplicate terms while preserving order, so "cat cat" is not double-weighted.
  q.terms = [...new Set(q.terms)];
  q.excluded = [...new Set(q.excluded)];

  const hasText = q.terms.length > 0 || q.phrases.length > 0;
  const hasFilter =
    q.tags.length > 0 || q.states.length > 0 || q.dates.length > 0 || q.excluded.length > 0;
  q.empty = !hasText && !hasFilter && q.scope === 'active';
  q.filtersOnly = !hasText && hasFilter;
  return q;
}

/** Does `tag` match `filter`, treating "/" as a nesting separator? */
export function tagMatches(tag: string, filter: string): boolean {
  return tag === filter || tag.startsWith(filter + '/');
}
