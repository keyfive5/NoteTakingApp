// Tokenizer for the search index.
//
// Apple Notes' search is an exact substring match, which is why it misses
// "lightbulb" when you typed "light bulb" and misses "run" when the note says
// "running". This tokenizer is built to close exactly those gaps:
//
//   * Unicode-aware word splitting, so accented and non-Latin text tokenises.
//   * Diacritic folding, so "resume" finds "résumé".
//   * Compound splitting on camelCase and letter/digit boundaries, so
//     "getUserId" is findable as "user" and "iphone15" as "15".
//   * A light stemmer, so "running" and "runs" both reduce to "run".
//
// Every token keeps its source offsets so the search layer can build snippets
// and highlight the exact characters that matched.

export interface Token {
  /** Folded, lowercased surface form. */
  text: string;
  /** Stemmed form; equals `text` when the stemmer made no change. */
  stem: string;
  /** Character offset of the token in the original string. */
  start: number;
  end: number;
  /** Ordinal position among tokens, used for phrase matching. */
  pos: number;
}

const COMBINING = /[̀-ͯ]/g;

/**
 * Lowercase, strip diacritics and drop apostrophes, so "Résumé" collides with
 * "resume" and "don't" with "dont". Applied to both indexed text and queries,
 * so the two always agree.
 */
export function fold(s: string): string {
  return s.normalize('NFD').replace(COMBINING, '').replace(/['’]/g, '').toLowerCase();
}

// A word is a run of letters, numbers and intra-word marks. Apostrophes are
// kept inside words ("don't") but stripped at the edges.
const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’_]*/gu;

/**
 * Split a raw word into sub-words on camelCase and letter/digit transitions.
 * Returns [] when the word has no internal boundaries, meaning "no extra
 * tokens beyond the word itself".
 */
export function splitCompound(word: string): { text: string; offset: number }[] {
  const parts: { text: string; offset: number }[] = [];
  let start = 0;
  const isUpper = (c: string) => c >= 'A' && c <= 'Z';
  const isLower = (c: string) => c >= 'a' && c <= 'z';
  const isDigit = (c: string) => c >= '0' && c <= '9';

  for (let i = 1; i < word.length; i++) {
    const prev = word[i - 1];
    const cur = word[i];
    const next = word[i + 1];
    const camel = isLower(prev) && isUpper(cur);
    // "HTTPServer" -> "HTTP" + "Server"
    const acronym = isUpper(prev) && isUpper(cur) && next !== undefined && isLower(next);
    const digitEdge = (isDigit(prev) && !isDigit(cur)) || (!isDigit(prev) && isDigit(cur));
    const punct = cur === '_' || cur === "'" || cur === '’';
    if (camel || acronym || digitEdge || punct) {
      if (i > start) parts.push({ text: word.slice(start, i), offset: start });
      start = punct ? i + 1 : i;
    }
  }
  if (start > 0 && start < word.length) parts.push({ text: word.slice(start), offset: start });
  return parts.length > 1 ? parts : [];
}

/**
 * A compact suffix-stripping stemmer. This is deliberately gentler than full
 * Porter: over-stemming makes search feel wrong ("universal" -> "univers"
 * matching "university" surprises people), so it only handles the affixes that
 * actually cause missed matches in notes.
 */
export function stem(w: string): string {
  if (w.length <= 3) return w;
  let s = w;

  // Plurals and third person singular. "ies" -> "y" is chosen over Porter's
  // "ies" -> "i" because it makes the true consonant+y plurals collide exactly
  // ("cities"/"city"); the -ie words it misses ("movies"/"movie") land one edit
  // apart and are recovered by the fuzzy layer instead.
  if (s.endsWith('ies') && s.length > 4) s = s.slice(0, -3) + 'y';
  else if (s.endsWith('sses')) s = s.slice(0, -2);
  else if (s.endsWith('ses') && s.length > 4) s = s.slice(0, -2);
  else if (s.endsWith('xes') || s.endsWith('zes') || s.endsWith('ches') || s.endsWith('shes'))
    s = s.slice(0, -2);
  else if (s.endsWith('s') && !s.endsWith('ss') && !s.endsWith('us') && !s.endsWith('is'))
    s = s.slice(0, -1);

  // Past tense and gerunds. Undo the consonant doubling and dropped-e that
  // English applies when it adds them ("running" -> "run", "moved" -> "move").
  if (s.endsWith('ing') && s.length > 5) s = restore(s.slice(0, -3));
  else if (s.endsWith('edly') && s.length > 6) s = restore(s.slice(0, -4));
  else if (s.endsWith('ed') && s.length > 4) s = restore(s.slice(0, -2));

  if (s.endsWith('ly') && s.length > 4) s = s.slice(0, -2);
  if (s.endsWith('ment') && s.length > 6) s = s.slice(0, -4);
  if (s.endsWith('ness') && s.length > 6) s = s.slice(0, -4);

  return s;
}

const VOWELS = 'aeiou';
/** Reverse the spelling changes English makes before -ing / -ed. */
function restore(base: string): string {
  if (base.length < 3) return base;
  const a = base[base.length - 1];
  const b = base[base.length - 2];
  // Doubled final consonant: "runn" -> "run", but keep "call", "pass", "buzz".
  if (a === b && !VOWELS.includes(a) && a !== 'l' && a !== 's' && a !== 'z') {
    return base.slice(0, -1);
  }
  // Stems that reliably dropped an "e": "creat" -> "create", "enabl" -> "enable",
  // "organiz" -> "organize", "mov" -> "move".
  if (base.endsWith('at') || base.endsWith('bl') || base.endsWith('iz')) return base + 'e';
  if (base.endsWith('v') || base.endsWith('u')) return base + 'e';
  return base;
}

/**
 * Tokenise a string into indexable tokens, including the sub-tokens produced by
 * compound splitting. Sub-tokens share the ordinal position of their parent so
 * phrase matching is not thrown off by them.
 */
export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let pos = 0;
  WORD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = WORD_RE.exec(text)) !== null) {
    const raw = m[0];
    const start = m.index;
    // Trim trailing apostrophes that the character class allowed in.
    const trimmed = raw.replace(/['’_]+$/, '');
    if (!trimmed) continue;

    const folded = fold(trimmed);
    out.push({ text: folded, stem: stem(folded), start, end: start + trimmed.length, pos });

    for (const part of splitCompound(trimmed)) {
      const pf = fold(part.text);
      if (pf && pf !== folded) {
        out.push({
          text: pf,
          stem: stem(pf),
          start: start + part.offset,
          end: start + part.offset + part.text.length,
          pos,
        });
      }
    }
    pos++;
  }
  return out;
}

/** Unique trigrams of a term, used to shortlist fuzzy candidates. */
export function trigrams(term: string): string[] {
  const padded = `  ${term} `;
  const set = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i++) set.add(padded.slice(i, i + 3));
  return [...set];
}
