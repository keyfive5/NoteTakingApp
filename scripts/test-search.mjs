// Search tests.
//
// The corpus below is deliberately realistic — overlapping vocabulary, similar
// titles, a mix of old and new — because ranking bugs only show up when several
// notes are plausible answers. Most assertions are of the form "this note must
// come first", which is the only thing a user actually perceives.
import { describe, eq, ok, report } from './harness.mjs';
import { buildIndex, decompose, preview, removeDoc, search, snippetFor, upsertDoc } from '../src/core/search/engine.ts';
import { parseQuery, tagMatches } from '../src/core/search/query.ts';
import { extractLinkKeys, extractTags } from '../src/core/links.ts';
import { emptyNote } from '../src/core/types.ts';

const DAY = 864e5;
const NOW = Date.UTC(2026, 7, 27);

let seq = 0;
function mk(title, body, extra = {}) {
  const n = emptyNote('n' + ++seq, NOW - (extra.ageDays ?? 10) * DAY);
  n.title = title;
  n.body = body;
  n.tags = extractTags(body);
  n.links = extractLinkKeys(body);
  n.updatedAt = NOW - (extra.ageDays ?? 10) * DAY;
  Object.assign(n, extra);
  return n;
}

const corpus = [
  mk('Meeting notes — Q3 planning', 'Discussed the roadmap with Priya. #work/planning\n- [ ] Send the deck\n- [x] Book the room\nWe agreed to revisit [[Budget 2026]] before shipping.', { ageDays: 2 }),
  mk('Budget 2026', 'Annual budget. Rent is the largest line. #work/finance\nGroceries average $520 a month.', { ageDays: 40 }),
  mk('Grocery list', 'milk, eggs, sourdough, olive oil, and a lightbulb for the hallway #home', { ageDays: 1 }),
  mk('Running plan', 'I am running four times a week now. Long run on Sunday. #health', { ageDays: 5 }),
  mk('Sourdough starter', 'Feed the starter every morning. Discard half. #home/kitchen #recipes', { ageDays: 8 }),
  mk('Architecture decisions', 'We chose a local-first architecture. See [[Meeting notes — Q3 planning]]. #work/eng', { ageDays: 15 }),
  mk('Reading list', 'Books: Piranesi, The Dispossessed, Mrs Dalloway. #reading', { ageDays: 90 }),
  mk('Cities visited', 'Kyoto, Lisbon, Montreal. Favourite city so far is Lisbon. #travel', { ageDays: 200 }),
  mk('Résumé draft', 'Updated the summary section. #work/career', { ageDays: 30 }),
  mk('Movie night', 'Movies to watch: Arrival, Paprika, Perfect Days. #fun', { ageDays: 3 }),
  mk('getUserId refactor', 'The getUserId helper should take a session, not a raw token. #work/eng', { ageDays: 6 }),
  mk('Old archived thing', 'Groceries and budgets from a previous year.', { ageDays: 400, archived: true }),
  mk('Deleted draft', 'A budget note that was thrown away.', { ageDays: 5, trashedAt: NOW - 2 * DAY }),
  mk('Team offsite', 'The team offsite is in Banff. Offsite agenda to follow. #work', { ageDays: 12 }),
  mk('Locked journal', 'Private thoughts. #journal', { ageDays: 4, locked: true }),
  mk('Pinned quick capture', 'Remember to call the dentist. #todo', { ageDays: 60, pinned: true }),
];

const notes = new Map(corpus.map((n) => [n.id, n]));
const index = buildIndex(corpus);
const run = (q, opts = {}) => search(index, notes, q, { now: NOW, ...opts });
const titles = (q, opts) => run(q, opts).map((r) => notes.get(r.id).title);
const first = (q, opts) => titles(q, opts)[0];

describe('the basics', () => {
  eq(first('sourdough starter'), 'Sourdough starter', 'exact title wins');
  eq(first('dentist'), 'Pinned quick capture', 'unique body word');
  ok(titles('budget').includes('Budget 2026'), 'finds by title word');
  eq(run('zzzzqqq').length, 0, 'no results for nonsense');
  ok(index.size === corpus.length, 'every note indexed');
});

describe('typo tolerance — the thing exact match cannot do', () => {
  eq(first('meting notes'), 'Meeting notes — Q3 planning', 'dropped letter');
  eq(first('arcitecture'), 'Architecture decisions', 'missing letter mid-word');
  eq(first('sourdogh'), 'Sourdough starter', 'transposed/wrong letter');
  eq(first('bugdet'), 'Budget 2026', 'transposition');
  eq(first('groceris'), 'Grocery list', 'plural typo still lands');
});

describe('stemming', () => {
  eq(first('run'), 'Running plan', '"run" finds "running"');
  ok(titles('cities').includes('Cities visited'), 'plural preserved');
  ok(titles('city').includes('Cities visited'), '"city" finds "Cities"');
  ok(titles('movie').includes('Movie night'), '"movie" finds "Movies" via fuzzy/stem');
  ok(titles('book').includes('Reading list'), '"book" finds "Books"');
});

describe('compound words — the lightbulb problem', () => {
  ok(titles('light bulb').includes('Grocery list'), '"light bulb" finds "lightbulb"');
  eq(decompose(index, 'lightbulb'), [], 'known word is not decomposed');
  ok(titles('user id').includes('getUserId refactor'), 'camelCase is findable as words');
  ok(titles('getuserid').includes('getUserId refactor'), 'and as the whole identifier');
});

describe('diacritics', () => {
  ok(titles('resume').includes('Résumé draft'), 'unaccented query finds accented note');
  ok(titles('résumé').includes('Résumé draft'), 'accented query works too');
});

describe('prefixes — search as you type', () => {
  for (const p of ['s', 'so', 'sou', 'sour', 'sourd']) {
    ok(titles(p).includes('Sourdough starter'), `"${p}" keeps the note in range`);
  }
  eq(first('sourd'), 'Sourdough starter', 'and it is the top hit by "sourd"');
});

describe('phrases', () => {
  eq(first('"team offsite"'), 'Team offsite', 'quoted phrase matches');
  eq(run('"offsite team"').length, 0, 'reversed phrase does not match');
  ok(run('"team offsite').length > 0, 'unterminated quote still searches');
});

describe('operators', () => {
  eq(titles('tag:work/eng').sort(), ['Architecture decisions', 'getUserId refactor'], 'nested tag filter');
  ok(titles('tag:work').includes('Team offsite'), 'parent tag matches children');
  eq(titles('is:pinned'), ['Pinned quick capture'], 'is:pinned');
  eq(titles('is:locked'), ['Locked journal'], 'is:locked');
  ok(titles('is:todo').includes('Meeting notes — Q3 planning'), 'is:todo finds open checkboxes');
  ok(!titles('is:todo').includes('Grocery list'), 'is:todo excludes notes with no checkbox');
  ok(titles('budget -grocery').includes('Budget 2026'), 'negation keeps the match');
  ok(!titles('grocery -lightbulb').includes('Grocery list'), 'negation removes the match');
  eq(titles('in:trash'), ['Deleted draft'], 'in:trash scope');
  ok(titles('in:archive').includes('Old archived thing'), 'in:archive scope');
});

describe('scope defaults', () => {
  ok(!titles('budget').includes('Deleted draft'), 'trashed notes hidden by default');
  ok(!titles('budget').includes('Old archived thing'), 'archived notes hidden by default');
  ok(titles('budget', { scope: 'all' }).includes('Old archived thing'), 'scope:all includes archive');
  ok(!titles('budget', { scope: 'all' }).includes('Deleted draft'), 'scope:all still excludes trash');
});

describe('ranking judgement', () => {
  // "budget" appears in the title of one note and the body of another. Title wins.
  eq(first('budget'), 'Budget 2026', 'title beats body');
  // Both notes mention groceries; the fresher, more focused one should lead.
  eq(first('groceries'), 'Grocery list', 'recency and focus break the tie');
  // Every term matching beats one term matching a lot.
  const r = titles('offsite banff');
  eq(r[0], 'Team offsite', 'full coverage ranks first');
  ok(run('meeting')[0].score > run('meeting')[1]?.score || run('meeting').length === 1, 'scores strictly ordered');
});

describe('listing mode', () => {
  const all = run('');
  eq(all.length, corpus.length - 2, 'empty query lists active notes only');
  ok(all.every((r) => r.listing), 'flagged as a listing');
  ok(all[0].snippet.length > 0, 'listings still carry a preview');
});

describe('snippets and highlights', () => {
  const r = run('sourdough')[0];
  ok(r.titleHighlights.length > 0, 'title highlight present');
  const g = run('lightbulb')[0];
  ok(g.snippet.includes('lightbulb'), 'snippet contains the match');
  const h = g.snippetHighlights[0];
  eq(g.snippet.slice(h.start, h.end), 'lightbulb', 'highlight offsets are exact');

  const long = 'x '.repeat(400) + 'NEEDLE here ' + 'y '.repeat(400);
  const s = snippetFor(long, new Set(['needle']));
  ok(s.text.includes('NEEDLE'), 'window centres on the match in a long note');
  ok(s.text.length < 220, 'snippet is bounded');
  eq(s.text.slice(s.highlights[0].start, s.highlights[0].end), 'NEEDLE', 'rebased offsets are exact');
});

describe('preview', () => {
  // The first non-empty line is the note's title, and the list row displays it
  // already, so the excerpt underneath starts after it.
  eq(preview('# Heading\n- [ ] do the thing'), 'do the thing', 'skips the title line');
  eq(preview('Title\n\nSee [[Budget 2026]] soon'), 'See Budget 2026 soon', 'unwraps wikilinks');
  eq(preview('Title\n**bold** and `code`'), 'bold and code', 'strips inline markers');
  eq(preview('Title\n> quoted\n- bullet'), 'quoted  bullet', 'strips block markers');
  eq(preview('Only one line'), '', 'a title-only note has no excerpt');
  eq(preview(''), '', 'empty body');
  eq(preview('\n\n  \n'), '', 'whitespace only');
  ok(preview('T\n' + 'x'.repeat(400)).endsWith('…'), 'long excerpts are truncated');
});

describe('parseQuery', () => {
  eq(parseQuery('').empty, true, 'empty is empty');
  eq(parseQuery('  ').empty, true, 'whitespace is empty');
  eq(parseQuery('hello world').terms, ['hello', 'world'], 'plain terms');
  eq(parseQuery('cat cat').terms, ['cat'], 'deduplicates');
  eq(parseQuery('"a b" c').phrases, [['a', 'b']], 'phrase captured');
  eq(parseQuery('#work/x').tags, ['work/x'], 'bare hashtag is a tag filter');
  eq(parseQuery('is:pinned').states, ['pinned'], 'state');
  eq(parseQuery('in:trash').scope, 'trash', 'scope');
  eq(parseQuery('-nope').excluded, ['nope'], 'exclusion');
  eq(parseQuery('weird:value').terms, ['weird', 'value'], 'unknown operator degrades to text');
  eq(parseQuery('updated:>2026-01-01').dates.length, 1, 'date bound parsed');
  eq(parseQuery('is:pinned').filtersOnly, true, 'filters-only detected');
  ok(tagMatches('work/clients/acme', 'work'), 'tag nesting matches');
  ok(!tagMatches('workshop', 'work'), 'tag prefix does not leak across names');
});

describe('robustness', () => {
  const empty = buildIndex([]);
  eq(search(empty, new Map(), 'anything').length, 0, 'empty index is safe');
  eq(search(empty, new Map(), '').length, 0, 'empty index, empty query');
  ok(run('   \n  ').every((r) => r.listing), 'whitespace query is a listing');
  ok(run('#').length >= 0, 'lone hash does not throw');
  ok(run('""').length >= 0, 'empty quotes do not throw');
  ok(run('a'.repeat(500)).length >= 0, 'very long term does not throw');
  ok(run('tag:').length >= 0, 'dangling operator does not throw');
});

describe('incremental index updates', () => {
  const live = corpus.map((n) => ({ ...n }));
  const map = new Map(live.map((n) => [n.id, n]));
  const idx = buildIndex(live);
  const find = (q) => search(idx, map, q, { now: NOW }).map((r) => map.get(r.id).title);

  eq(idx.size, corpus.length, 'starts at full size');
  ok(find('sourdough').includes('Sourdough starter'), 'baseline match');

  // Edit a note: the old text must stop matching and the new text must start.
  const edited = { ...map.get(live[4].id), body: 'Now about kombucha brewing instead.', rev: 2 };
  edited.tags = extractTags(edited.body);
  map.set(edited.id, edited);
  upsertDoc(idx, edited);

  eq(idx.size, corpus.length, 'size unchanged after an edit');
  ok(find('kombucha').includes('Sourdough starter'), 'new text is findable');
  ok(!find('discard').includes('Sourdough starter'), 'old body text no longer matches');
  ok(find('sourdough').includes('Sourdough starter'), 'title still matches');

  // Delete.
  removeDoc(idx, edited.id);
  map.delete(edited.id);
  eq(idx.size, corpus.length - 1, 'size drops after removal');
  ok(!find('kombucha').includes('Sourdough starter'), 'removed note is gone');
  ok(find('budget').length > 0, 'other notes unaffected');

  // Adding a brand new note.
  const fresh = mk('Kombucha log', 'Second ferment with ginger. #home/kitchen');
  map.set(fresh.id, fresh);
  upsertDoc(idx, fresh);
  eq(search(idx, map, 'ginger', { now: NOW }).length, 1, 'new note is searchable');
  eq(idx.size, corpus.length, 'size back up');

  // Repeated edits accumulate tombstones but must never change results.
  for (let i = 0; i < 30; i++) {
    const n = { ...map.get(fresh.id), body: `Revision ${i} with ginger. #home/kitchen` };
    map.set(n.id, n);
    upsertDoc(idx, n);
  }
  eq(idx.size, corpus.length, 'size stable across many edits');
  eq(search(idx, map, 'ginger', { now: NOW }).length, 1, 'still exactly one match');
  ok(idx.deadCount >= 30, 'tombstones accumulated as expected');
  ok(!idx.shouldCompact, 'not yet worth compacting');
});

report('search');
