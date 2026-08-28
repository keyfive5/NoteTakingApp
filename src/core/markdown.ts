// Markdown parsing for rendering and for the editor's smart behaviours.
//
// This is not a general CommonMark implementation and does not try to be. It
// covers exactly the constructs a note-taker uses, and it is written so that
// every block knows the character range it came from — which is what lets the
// reader view be tappable: tap a rendered line, land the cursor on the matching
// character in the source.

export interface Span {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  highlight?: boolean;
  /** An external URL. */
  href?: string;
  /** A [[wikilink]] target, normalised. */
  wikiKey?: string;
  /** The raw wikilink target as written, for creating the note. */
  wikiTarget?: string;
  /** A #tag, without the hash. */
  tag?: string;
}

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; spans: Span[]; start: number; end: number }
  | { kind: 'paragraph'; spans: Span[]; start: number; end: number }
  | { kind: 'bullet'; depth: number; spans: Span[]; start: number; end: number }
  | { kind: 'numbered'; depth: number; label: number; spans: Span[]; start: number; end: number }
  | { kind: 'task'; depth: number; checked: boolean; spans: Span[]; start: number; end: number }
  | { kind: 'quote'; spans: Span[]; start: number; end: number }
  | { kind: 'code'; lang: string; text: string; start: number; end: number }
  | { kind: 'divider'; start: number; end: number }
  | { kind: 'blank'; start: number; end: number };

const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^(\s*)[-*•]\s+(.*)$/;
const NUMBERED = /^(\s*)(\d+)[.)]\s+(.*)$/;
const TASK = /^(\s*)[-*]\s+\[([ xX])\]\s*(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const DIVIDER = /^(?:---+|\*\*\*+|___+)\s*$/;
const FENCE = /^```(\w*)\s*$/;

/** Indentation width that counts as one nesting level. */
const INDENT = 2;

export function parseBlocks(source: string): Block[] {
  const out: Block[] = [];
  const lines = source.split('\n');
  let offset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const start = offset;
    offset += line.length + 1;

    const fence = FENCE.exec(line);
    if (fence) {
      // Consume through the closing fence, or to the end of the note.
      const body: string[] = [];
      let end = start + line.length;
      let j = i + 1;
      for (; j < lines.length; j++) {
        end = offset + lines[j].length;
        if (/^```\s*$/.test(lines[j])) {
          offset += lines[j].length + 1;
          j++;
          break;
        }
        body.push(lines[j]);
        offset += lines[j].length + 1;
      }
      out.push({ kind: 'code', lang: fence[1], text: body.join('\n'), start, end });
      i = j - 1;
      continue;
    }

    if (line.trim() === '') {
      out.push({ kind: 'blank', start, end: start + line.length });
      continue;
    }
    if (DIVIDER.test(line)) {
      out.push({ kind: 'divider', start, end: start + line.length });
      continue;
    }

    const end = start + line.length;
    const h = HEADING.exec(line);
    if (h) {
      out.push({
        kind: 'heading',
        level: h[1].length as 1 | 2 | 3,
        spans: parseInline(h[2]),
        start,
        end,
      });
      continue;
    }
    // Tasks are checked before bullets, since "- [ ] x" also matches BULLET.
    const t = TASK.exec(line);
    if (t) {
      out.push({
        kind: 'task',
        depth: Math.floor(t[1].length / INDENT),
        checked: t[2] !== ' ',
        spans: parseInline(t[3]),
        start,
        end,
      });
      continue;
    }
    const b = BULLET.exec(line);
    if (b) {
      out.push({
        kind: 'bullet',
        depth: Math.floor(b[1].length / INDENT),
        spans: parseInline(b[2]),
        start,
        end,
      });
      continue;
    }
    const nu = NUMBERED.exec(line);
    if (nu) {
      out.push({
        kind: 'numbered',
        depth: Math.floor(nu[1].length / INDENT),
        label: parseInt(nu[2], 10),
        spans: parseInline(nu[3]),
        start,
        end,
      });
      continue;
    }
    const qt = QUOTE.exec(line);
    if (qt) {
      out.push({ kind: 'quote', spans: parseInline(qt[1]), start, end });
      continue;
    }
    out.push({ kind: 'paragraph', spans: parseInline(line), start, end });
  }
  return out;
}

// Inline markers, longest first so "**" is tried before "*".
const MARKERS: { open: string; close: string; key: keyof Span }[] = [
  { open: '***', close: '***', key: 'bold' },
  { open: '**', close: '**', key: 'bold' },
  { open: '~~', close: '~~', key: 'strike' },
  { open: '==', close: '==', key: 'highlight' },
  { open: '*', close: '*', key: 'italic' },
  { open: '_', close: '_', key: 'italic' },
];

const URL_RE = /^(https?:\/\/[^\s<>"')\]]+|www\.[^\s<>"')\]]+)/i;
const MD_LINK_RE = /^\[([^\]\n]*)\]\(([^)\s]+)\)/;
const WIKI_RE = /^\[\[([^\]|\n]+)(?:\|([^\]\n]*))?\]\]/;
const TAG_RE = /^#([\p{L}\p{N}][\p{L}\p{N}_/-]*)/u;

/**
 * Parse inline formatting into styled spans.
 *
 * Written as a single left-to-right scan with an active-style set rather than a
 * nested-node tree: notes rarely nest formatting deeply, and a flat span list is
 * exactly what a React Native <Text> run wants.
 */
export function parseInline(line: string): Span[] {
  const out: Span[] = [];
  const active: Partial<Span> = {};
  let buf = '';

  const flush = () => {
    if (buf) {
      out.push({ ...active, text: buf });
      buf = '';
    }
  };
  const push = (span: Span) => {
    flush();
    out.push(span);
  };

  let i = 0;
  while (i < line.length) {
    const rest = line.slice(i);

    // Inline code wins over every other marker, so `**` inside code stays literal.
    if (line[i] === '`') {
      const close = line.indexOf('`', i + 1);
      if (close > i) {
        push({ ...active, text: line.slice(i + 1, close), code: true });
        i = close + 1;
        continue;
      }
    }

    const wiki = WIKI_RE.exec(rest);
    if (wiki) {
      const target = wiki[1].trim();
      push({
        ...active,
        text: (wiki[2] ?? '').trim() || target,
        wikiKey: target.toLowerCase().replace(/\s+/g, ' ').trim(),
        wikiTarget: target,
      });
      i += wiki[0].length;
      continue;
    }

    const md = MD_LINK_RE.exec(rest);
    if (md) {
      push({ ...active, text: md[1] || md[2], href: md[2] });
      i += md[0].length;
      continue;
    }

    const url = URL_RE.exec(rest);
    if (url) {
      const raw = url[1].replace(/[.,;:!?]+$/, '');
      push({ ...active, text: raw, href: raw.startsWith('www.') ? 'https://' + raw : raw });
      i += raw.length;
      continue;
    }

    // A tag only starts at a word boundary, so "C#" is not a tag.
    if (line[i] === '#' && (i === 0 || /[\s([]/.test(line[i - 1]))) {
      const tag = TAG_RE.exec(rest);
      if (tag && /\p{L}/u.test(tag[1])) {
        push({ ...active, text: tag[0], tag: tag[1].replace(/\/+$/, '').toLowerCase() });
        i += tag[0].length;
        continue;
      }
    }

    let matched = false;
    for (const m of MARKERS) {
      if (!rest.startsWith(m.open)) continue;
      if (active[m.key]) {
        // Closing an open marker.
        flush();
        delete active[m.key];
        if (m.open === '***') delete active.italic;
        i += m.open.length;
        matched = true;
        break;
      }
      // Only treat it as an opener if a closer exists later on this line, and
      // the marker is not floating in whitespace ("2 * 3 * 4" is not italic).
      const closeAt = line.indexOf(m.close, i + m.open.length);
      if (closeAt < 0) continue;
      // Reject an empty pair. Without this, the second star of an unclosed
      // "**bold" is read as the closer of a single-star italic, silently eating
      // both markers instead of leaving the text alone.
      if (closeAt <= i + m.open.length) continue;
      if (/\s/.test(line[i + m.open.length] ?? ' ')) continue;
      flush();
      (active as Record<string, unknown>)[m.key] = true;
      if (m.open === '***') active.italic = true;
      i += m.open.length;
      matched = true;
      break;
    }
    if (matched) continue;

    buf += line[i];
    i++;
  }
  flush();
  return out.filter((s) => s.text !== '');
}

/** Plain text of a span list, for previews and accessibility labels. */
export function spansToText(spans: Span[]): string {
  return spans.map((s) => s.text).join('');
}

/**
 * The note's title is its first non-empty line, with list and heading markers
 * stripped. Following the first line rather than storing a separate title field
 * is what Bear and Obsidian do, and it means there is no second thing that can
 * fall out of sync with what the note actually says.
 */
export function deriveTitle(source: string, fallback = ''): string {
  for (const line of source.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    return (
      t
        .replace(/^#{1,6}\s+/, '')
        .replace(/^[-*]\s+\[[ xX]\]\s*/, '')
        .replace(/^[-*>]\s+/, '')
        .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1')
        .trim()
        .slice(0, 120) || fallback
    );
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Editor behaviours
// ---------------------------------------------------------------------------

/** The line containing `pos`, as a [start, end) range excluding the newline. */
export function lineRangeAt(text: string, pos: number): { start: number; end: number } {
  const clamped = Math.max(0, Math.min(pos, text.length));
  let start = clamped;
  while (start > 0 && text[start - 1] !== '\n') start--;
  let end = clamped;
  while (end < text.length && text[end] !== '\n') end++;
  return { start, end };
}

export interface ListContinuation {
  /** Text to insert in place of the newline. */
  insert: string;
  /** Range of the current line to remove first, for exiting an empty item. */
  remove?: { start: number; end: number };
}

/**
 * What pressing Return should do.
 *
 * Continuing the list is the whole point — typing "- " once and having every
 * subsequent line carry it is the difference between a list feeling native and
 * feeling like a text file. Pressing Return on an empty item ends the list
 * instead of adding another empty one.
 */
export function continueList(text: string, pos: number): ListContinuation {
  const { start, end } = lineRangeAt(text, pos);
  const line = text.slice(start, end);

  const task = TASK.exec(line);
  if (task) {
    if (task[3].trim() === '') return { insert: '\n', remove: { start, end } };
    return { insert: `\n${task[1]}- [ ] ` };
  }
  const bullet = BULLET.exec(line);
  if (bullet) {
    if (bullet[2].trim() === '') return { insert: '\n', remove: { start, end } };
    return { insert: `\n${bullet[1]}- ` };
  }
  const numbered = NUMBERED.exec(line);
  if (numbered) {
    if (numbered[3].trim() === '') return { insert: '\n', remove: { start, end } };
    return { insert: `\n${numbered[1]}${parseInt(numbered[2], 10) + 1}. ` };
  }
  const quote = QUOTE.exec(line);
  if (quote) {
    if (quote[1].trim() === '') return { insert: '\n', remove: { start, end } };
    return { insert: '\n> ' };
  }
  return { insert: '\n' };
}

/** Flip the checkbox on the line containing `pos`. Returns null if there is none. */
export function toggleTask(text: string, pos: number): string | null {
  const { start, end } = lineRangeAt(text, pos);
  const line = text.slice(start, end);
  const m = TASK.exec(line);
  if (!m) return null;
  const replaced = line.replace(/\[([ xX])\]/, m[2] === ' ' ? '[x]' : '[ ]');
  return text.slice(0, start) + replaced + text.slice(end);
}

export type LinePrefix = 'bullet' | 'task' | 'numbered' | 'quote' | 'h1' | 'h2' | 'h3';

const PREFIX_TEXT: Record<LinePrefix, string> = {
  bullet: '- ',
  task: '- [ ] ',
  numbered: '1. ',
  quote: '> ',
  h1: '# ',
  h2: '## ',
  h3: '### ',
};

const ANY_PREFIX = /^(\s*)(?:#{1,6}\s+|[-*]\s+\[[ xX]\]\s*|[-*]\s+|\d+[.)]\s+|>\s?)?/;

/**
 * Apply or remove a line prefix across the selection. Toggling off restores the
 * bare line, and switching between prefixes replaces rather than stacks them.
 */
export function toggleLinePrefix(
  text: string,
  selStart: number,
  selEnd: number,
  prefix: LinePrefix,
): { text: string; selection: { start: number; end: number } } {
  const first = lineRangeAt(text, selStart);
  const last = lineRangeAt(text, selEnd);
  const block = text.slice(first.start, last.end);
  const lines = block.split('\n');
  const want = PREFIX_TEXT[prefix];

  // If every non-empty line already has this exact prefix, toggle it off.
  const nonEmpty = lines.filter((l) => l.trim() !== '');
  const allHave =
    nonEmpty.length > 0 &&
    nonEmpty.every((l) => {
      const indent = ANY_PREFIX.exec(l)![1];
      return l.startsWith(indent + want);
    });

  const next = lines.map((line) => {
    if (line.trim() === '') return line;
    const m = ANY_PREFIX.exec(line)!;
    const indent = m[1];
    const bare = line.slice(m[0].length);
    return allHave ? indent + bare : indent + want + bare;
  });

  const replacement = next.join('\n');
  return {
    text: text.slice(0, first.start) + replacement + text.slice(last.end),
    selection: { start: first.start, end: first.start + replacement.length },
  };
}

/**
 * Wrap or unwrap the selection in an inline marker. With an empty selection the
 * markers are inserted and the cursor placed between them.
 */
export function toggleInline(
  text: string,
  selStart: number,
  selEnd: number,
  marker: string,
): { text: string; selection: { start: number; end: number } } {
  const selected = text.slice(selStart, selEnd);
  const before = text.slice(selStart - marker.length, selStart);
  const after = text.slice(selEnd, selEnd + marker.length);

  // Already wrapped just outside the selection: unwrap.
  if (before === marker && after === marker) {
    return {
      text: text.slice(0, selStart - marker.length) + selected + text.slice(selEnd + marker.length),
      selection: { start: selStart - marker.length, end: selEnd - marker.length },
    };
  }
  // Already wrapped inside the selection: unwrap.
  if (selected.length >= marker.length * 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(marker.length, -marker.length);
    return {
      text: text.slice(0, selStart) + inner + text.slice(selEnd),
      selection: { start: selStart, end: selStart + inner.length },
    };
  }
  const wrapped = marker + selected + marker;
  return {
    text: text.slice(0, selStart) + wrapped + text.slice(selEnd),
    selection: selected
      ? { start: selStart, end: selStart + wrapped.length }
      : { start: selStart + marker.length, end: selStart + marker.length },
  };
}

/** Indent or outdent the lines touched by the selection. */
export function shiftIndent(
  text: string,
  selStart: number,
  selEnd: number,
  direction: 1 | -1,
): { text: string; selection: { start: number; end: number } } {
  const first = lineRangeAt(text, selStart);
  const last = lineRangeAt(text, selEnd);
  const pad = ' '.repeat(INDENT);
  const next = text
    .slice(first.start, last.end)
    .split('\n')
    .map((line) => {
      if (direction === 1) return line.trim() === '' ? line : pad + line;
      return line.startsWith(pad) ? line.slice(INDENT) : line.replace(/^\s+/, '');
    })
    .join('\n');
  return {
    text: text.slice(0, first.start) + next + text.slice(last.end),
    selection: { start: first.start, end: first.start + next.length },
  };
}

/**
 * The word being typed right before the cursor, used to drive [[link]] and #tag
 * autocomplete. Returns null when the cursor is not inside such a token.
 */
export function activeToken(text: string, pos: number): { kind: 'wiki' | 'tag'; query: string; start: number } | null {
  const upto = text.slice(0, pos);
  const wiki = upto.lastIndexOf('[[');
  if (wiki >= 0) {
    const between = upto.slice(wiki + 2);
    if (!between.includes(']]') && !between.includes('\n')) {
      return { kind: 'wiki', query: between, start: wiki };
    }
  }
  const m = /(^|[\s(])#([\p{L}\p{N}][\p{L}\p{N}_/-]*)?$/u.exec(upto);
  if (m) return { kind: 'tag', query: m[2] ?? '', start: pos - (m[2]?.length ?? 0) - 1 };
  return null;
}
