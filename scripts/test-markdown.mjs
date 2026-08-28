// Markdown parser and editor-behaviour tests.
import { describe, eq, ok, report } from './harness.mjs';
import {
  activeToken, continueList, deriveTitle, lineRangeAt, parseBlocks, parseInline,
  shiftIndent, spansToText, toggleInline, toggleLinePrefix, toggleTask,
} from '../src/core/markdown.ts';

const kinds = (s) => parseBlocks(s).map((b) => b.kind);
const text = (s) => parseInline(s).map((x) => x.text);

describe('blocks', () => {
  eq(kinds('# Title'), ['heading'], 'heading');
  eq(parseBlocks('## Two')[0].level, 2, 'heading level');
  eq(kinds('- a'), ['bullet'], 'bullet');
  eq(kinds('- [ ] a'), ['task'], 'task beats bullet');
  eq(kinds('- [x] a'), ['task'], 'checked task');
  eq(parseBlocks('- [x] a')[0].checked, true, 'checked flag');
  eq(parseBlocks('- [ ] a')[0].checked, false, 'unchecked flag');
  eq(kinds('1. a'), ['numbered'], 'numbered');
  eq(parseBlocks('7. a')[0].label, 7, 'keeps its number');
  eq(kinds('> quoted'), ['quote'], 'quote');
  eq(kinds('---'), ['divider'], 'divider');
  eq(kinds(''), ['blank'], 'blank');
  eq(kinds('plain'), ['paragraph'], 'paragraph');
  eq(kinds('# a\n\n- b\n> c'), ['heading', 'blank', 'bullet', 'quote'], 'mixed document');
});

describe('nesting', () => {
  eq(parseBlocks('  - deep')[0].depth, 1, 'two spaces is one level');
  eq(parseBlocks('    - deeper')[0].depth, 2, 'four spaces is two levels');
  eq(parseBlocks('- [ ] a\n  - [ ] b')[1].depth, 1, 'nested task');
});

describe('code fences', () => {
  const b = parseBlocks('```js\nconst a = 1;\nconst b = 2;\n```');
  eq(b.length, 1, 'one block');
  eq(b[0].kind, 'code', 'code kind');
  eq(b[0].lang, 'js', 'language captured');
  eq(b[0].text, 'const a = 1;\nconst b = 2;', 'body preserved verbatim');
  const unclosed = parseBlocks('```\nstill code');
  eq(unclosed[0].kind, 'code', 'unterminated fence still parses');
  eq(unclosed[0].text, 'still code', 'and keeps its content');
  // Markdown inside a fence must stay literal.
  eq(parseBlocks('```\n# not a heading\n```')[0].text, '# not a heading', 'no parsing inside code');
});

describe('source offsets', () => {
  const src = '# One\nsecond line\n- third';
  const blocks = parseBlocks(src);
  for (const b of blocks) {
    ok(src.slice(b.start, b.end).length === b.end - b.start, 'range is well formed');
  }
  eq(src.slice(blocks[0].start, blocks[0].end), '# One', 'heading range');
  eq(src.slice(blocks[1].start, blocks[1].end), 'second line', 'paragraph range');
  eq(src.slice(blocks[2].start, blocks[2].end), '- third', 'bullet range');
});

describe('inline formatting', () => {
  eq(parseInline('**bold**')[0].bold, true, 'bold');
  eq(parseInline('*italic*')[0].italic, true, 'italic');
  eq(parseInline('_italic_')[0].italic, true, 'underscore italic');
  eq(parseInline('~~gone~~')[0].strike, true, 'strikethrough');
  eq(parseInline('==hi==')[0].highlight, true, 'highlight');
  eq(parseInline('`code`')[0].code, true, 'inline code');
  eq(text('**bold**'), ['bold'], 'markers removed from text');
  eq(text('a **b** c'), ['a ', 'b', ' c'], 'splits around the marker');
  const both = parseInline('***all***')[0];
  ok(both.bold && both.italic, 'triple marker is bold and italic');
});

describe('inline edge cases', () => {
  eq(text('2 * 3 * 4'), ['2 * 3 * 4'], 'arithmetic is not italic');
  eq(text('unclosed **bold'), ['unclosed **bold'], 'unclosed marker stays literal');
  eq(parseInline('`**not bold**`')[0].code, true, 'code wins over emphasis');
  eq(text('`**not bold**`'), ['**not bold**'], 'and keeps the markers as text');
  eq(parseInline('').length, 0, 'empty line');
  eq(text('a_b_c'), ['a', 'b', 'c'], 'intra-word underscore still parses');
});

describe('links and tags', () => {
  const w = parseInline('see [[My Note]] here')[1];
  eq(w.text, 'My Note', 'wikilink text');
  eq(w.wikiKey, 'my note', 'wikilink key is normalised');
  const alias = parseInline('[[Target|shown]]')[0];
  eq(alias.text, 'shown', 'alias is displayed');
  eq(alias.wikiKey, 'target', 'but the target is kept');

  const md = parseInline('[label](https://example.com)')[0];
  eq(md.href, 'https://example.com', 'markdown link href');
  eq(md.text, 'label', 'markdown link label');

  eq(parseInline('go to https://a.co now')[1].href, 'https://a.co', 'bare url');
  eq(parseInline('visit www.a.co')[1].href, 'https://www.a.co', 'www gets a scheme');
  eq(parseInline('see https://a.co.')[1].text, 'https://a.co', 'trailing period not part of url');

  eq(parseInline('a #work/x b')[1].tag, 'work/x', 'tag parsed');
  eq(parseInline('#lead')[0].tag, 'lead', 'tag at line start');
  eq(parseInline('C# is fine').filter((s) => s.tag).length, 0, 'C# is not a tag');
  eq(parseInline('#123').filter((s) => s.tag).length, 0, 'numeric hash is not a tag');
});

describe('deriveTitle', () => {
  eq(deriveTitle('# Hello\nbody'), 'Hello', 'strips heading marker');
  eq(deriveTitle('\n\n  Spaced  \nmore'), 'Spaced', 'skips blank lines');
  eq(deriveTitle('- [ ] a task'), 'a task', 'strips task marker');
  eq(deriveTitle('- bullet'), 'bullet', 'strips bullet');
  eq(deriveTitle('', 'Untitled'), 'Untitled', 'falls back');
  eq(deriveTitle('   \n  ', 'Untitled'), 'Untitled', 'whitespace falls back');
});

describe('lineRangeAt', () => {
  const t = 'one\ntwo\nthree';
  eq(t.slice(...Object.values(lineRangeAt(t, 0))), 'one', 'first line');
  eq(t.slice(...Object.values(lineRangeAt(t, 5))), 'two', 'middle line');
  eq(t.slice(...Object.values(lineRangeAt(t, 99))), 'three', 'clamps past the end');
});

describe('continueList', () => {
  eq(continueList('- item', 6).insert, '\n- ', 'continues a bullet');
  eq(continueList('- [ ] item', 10).insert, '\n- [ ] ', 'continues a task unchecked');
  eq(continueList('- [x] done', 10).insert, '\n- [ ] ', 'next task starts unchecked');
  eq(continueList('3. item', 7).insert, '\n4. ', 'increments the number');
  eq(continueList('> quoted', 8).insert, '\n> ', 'continues a quote');
  eq(continueList('  - nested', 10).insert, '\n  - ', 'preserves indentation');
  eq(continueList('plain', 5).insert, '\n', 'plain text just breaks');

  // Return on an empty item ends the list rather than adding another.
  const exit = continueList('- ', 2);
  eq(exit.insert, '\n', 'empty bullet exits');
  eq(exit.remove, { start: 0, end: 2 }, 'and removes the empty marker');
  ok(continueList('- [ ] ', 6).remove !== undefined, 'empty task exits too');
});

describe('toggleTask', () => {
  eq(toggleTask('- [ ] a', 3), '- [x] a', 'check');
  eq(toggleTask('- [x] a', 3), '- [ ] a', 'uncheck');
  eq(toggleTask('plain', 2), null, 'not a task');
  eq(toggleTask('- [ ] a\n- [ ] b', 9), '- [ ] a\n- [x] b', 'toggles the right line');
});

describe('toggleLinePrefix', () => {
  eq(toggleLinePrefix('abc', 0, 3, 'bullet').text, '- abc', 'adds');
  eq(toggleLinePrefix('- abc', 0, 5, 'bullet').text, 'abc', 'removes');
  eq(toggleLinePrefix('- abc', 0, 5, 'task').text, '- [ ] abc', 'replaces rather than stacking');
  eq(toggleLinePrefix('# abc', 0, 5, 'h2').text, '## abc', 'switches heading level');
  eq(toggleLinePrefix('a\nb', 0, 3, 'bullet').text, '- a\n- b', 'across multiple lines');
  eq(toggleLinePrefix('- a\n- b', 0, 7, 'bullet').text, 'a\nb', 'removes across lines');
  // Mixed selection: normalise every line to the requested prefix rather than
  // stacking a second marker onto the lines that already have one.
  eq(toggleLinePrefix('- a\nb', 0, 5, 'bullet').text, '- a\n- b', 'partial coverage normalises all lines');
  eq(toggleLinePrefix('1. a\nb', 0, 6, 'bullet').text, '- a\n- b', 'converts numbered to bullet');
  eq(toggleLinePrefix('  a', 0, 3, 'bullet').text, '  - a', 'keeps indentation');
});

describe('toggleInline', () => {
  eq(toggleInline('abc', 0, 3, '**').text, '**abc**', 'wraps');
  eq(toggleInline('**abc**', 2, 5, '**').text, 'abc', 'unwraps from outside');
  eq(toggleInline('**abc**', 0, 7, '**').text, 'abc', 'unwraps from inside');
  const empty = toggleInline('ab', 1, 1, '**');
  eq(empty.text, 'a****b', 'inserts an empty pair');
  eq(empty.selection, { start: 3, end: 3 }, 'and puts the cursor between them');
});

describe('shiftIndent', () => {
  eq(shiftIndent('- a', 0, 3, 1).text, '  - a', 'indents');
  eq(shiftIndent('  - a', 0, 5, -1).text, '- a', 'outdents');
  eq(shiftIndent('- a', 0, 3, -1).text, '- a', 'outdent at zero is a no-op');
  eq(shiftIndent('a\nb', 0, 3, 1).text, '  a\n  b', 'multi-line');
});

describe('activeToken', () => {
  eq(activeToken('see [[My N', 10), { kind: 'wiki', query: 'My N', start: 4 }, 'wiki in progress');
  eq(activeToken('see [[Done]] x', 14), null, 'closed wikilink is not active');
  eq(activeToken('tag #wo', 7).kind, 'tag', 'tag in progress');
  eq(activeToken('tag #wo', 7).query, 'wo', 'tag query');
  eq(activeToken('#', 1), { kind: 'tag', query: '', start: 0 }, 'bare hash starts a tag');
  eq(activeToken('nothing here', 12), null, 'plain text');
  eq(activeToken('', 0), null, 'empty');
});

describe('round trip on a realistic note', () => {
  const src = [
    '# Weekly review',
    '',
    'Focus for the week is **shipping** the ==search== rewrite.',
    '',
    '- [x] Ship the tokenizer',
    '- [ ] Ship the ranker',
    '  - [ ] BM25F weights',
    '',
    '> Quote worth keeping',
    '',
    '```ts',
    'const x: number = 1;',
    '```',
    '',
    'Links to [[Budget 2026]] and https://example.com #work/review',
  ].join('\n');
  const blocks = parseBlocks(src);
  eq(blocks.filter((b) => b.kind === 'task').length, 3, 'three tasks');
  eq(blocks.filter((b) => b.kind === 'code').length, 1, 'one code block');
  eq(blocks.find((b) => b.kind === 'code').text, 'const x: number = 1;', 'code intact');
  ok(blocks.some((b) => b.kind === 'quote'), 'quote present');
  const last = blocks[blocks.length - 1];
  ok(last.spans.some((s) => s.wikiKey === 'budget 2026'), 'wikilink found');
  ok(last.spans.some((s) => s.href), 'url found');
  ok(last.spans.some((s) => s.tag === 'work/review'), 'tag found');
  eq(deriveTitle(src), 'Weekly review', 'title derived');
  // Every block's source range must be inside the document.
  ok(blocks.every((b) => b.start >= 0 && b.end <= src.length && b.start <= b.end), 'ranges in bounds');
  eq(spansToText(parseInline('a **b** c')), 'a b c', 'spansToText round trip');
});

report('markdown');
