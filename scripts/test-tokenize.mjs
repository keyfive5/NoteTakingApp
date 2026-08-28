// Tokenizer tests. These encode the specific search failures this app exists to
// fix, so they double as a spec for "what should be findable".
import { describe, eq, ok, report } from './harness.mjs';
import { fold, splitCompound, stem, tokenize, trigrams } from '../src/core/search/tokenize.ts';

const words = (s) => tokenize(s).map((t) => t.text);
const stems = (s) => tokenize(s).map((t) => t.stem);

describe('fold', () => {
  eq(fold('Résumé'), 'resume', 'strips diacritics');
  eq(fold("Don't"), 'dont', 'drops apostrophes');
  eq(fold('Ünïcōde'), 'unicode', 'folds mixed marks');
  eq(fold('ÅÄÖ'), 'aao', 'folds Nordic vowels');
});

describe('splitCompound', () => {
  eq(splitCompound('getUserId').map((p) => p.text), ['get', 'User', 'Id'], 'camelCase');
  eq(splitCompound('HTTPServer').map((p) => p.text), ['HTTP', 'Server'], 'acronym boundary');
  eq(splitCompound('iphone15').map((p) => p.text), ['iphone', '15'], 'letter/digit');
  eq(splitCompound('light_bulb').map((p) => p.text), ['light', 'bulb'], 'underscore');
  eq(splitCompound('plain').map((p) => p.text), [], 'no boundaries yields nothing');
  eq(splitCompound('Title').map((p) => p.text), [], 'leading capital is not a boundary');
});

describe('stem: plurals', () => {
  eq(stem('runs'), 'run', 'simple -s');
  eq(stem('cities'), 'city', '-ies to -y');
  eq(stem('passes'), 'pass', '-sses');
  eq(stem('buses'), 'bus', '-ses');
  eq(stem('boxes'), 'box', '-xes');
  eq(stem('churches'), 'church', '-ches');
  eq(stem('dishes'), 'dish', '-shes');
  eq(stem('status'), 'status', 'leaves -us alone');
  eq(stem('analysis'), 'analysis', 'leaves -is alone');
  eq(stem('this'), 'this', 'leaves "this" alone');
  eq(stem('glass'), 'glass', 'leaves -ss alone');
});

describe('stem: verb forms', () => {
  eq(stem('running'), 'run', 'undoes consonant doubling');
  eq(stem('planning'), 'plan', 'undoes doubling (plan)');
  eq(stem('calling'), 'call', 'keeps real double-l');
  eq(stem('meeting'), 'meet', 'no false restoration');
  eq(stem('created'), 'create', 'restores dropped e (-at)');
  eq(stem('enabled'), 'enable', 'restores dropped e (-bl)');
  eq(stem('organized'), 'organize', 'restores dropped e (-iz)');
  eq(stem('moved'), 'move', 'restores dropped e (-v)');
  eq(stem('quickly'), 'quick', '-ly');
  eq(stem('shipment'), 'ship', '-ment');
});

describe('stem: the point of it', () => {
  // A query and a document form must converge on the same stem, or search
  // silently misses. Each pair below is a real miss in exact-match search.
  const pairs = [
    ['running', 'run'], ['runs', 'run'], ['cities', 'city'],
    ['meetings', 'meeting'], ['created', 'create'], ['moved', 'move'],
    ['boxes', 'box'], ['dishes', 'dish'], ['organized', 'organize'],
  ];
  for (const [a, b] of pairs) ok(stem(a) === stem(b), `"${a}" and "${b}" converge (${stem(a)} vs ${stem(b)})`);
});

describe('tokenize', () => {
  eq(words('Hello, world!'), ['hello', 'world'], 'splits on punctuation');
  eq(words('getUserId'), ['getuserid', 'get', 'user', 'id'], 'emits whole word plus parts');
  ok(words('The lightbulb moment').includes('lightbulb'), 'keeps solid compounds whole');
  eq(words(''), [], 'empty string');
  eq(words('   \n\t  '), [], 'whitespace only');
  eq(words('café'), ['cafe'], 'folds while tokenising');
  eq(stems('I am running late'), ['i', 'am', 'run', 'late'], 'stems in place');

  const toks = tokenize('alpha beta');
  eq(toks.map((t) => [t.start, t.end]), [[0, 5], [6, 10]], 'offsets point at the source');
  eq(toks.map((t) => t.pos), [0, 1], 'ordinal positions');

  const camel = tokenize('a getUserId b');
  eq(camel.map((t) => t.pos), [0, 1, 1, 1, 1, 2], 'sub-tokens share their parent position');
  const userTok = camel.find((t) => t.text === 'user');
  eq('a getUserId b'.slice(userTok.start, userTok.end), 'User', 'sub-token offsets are exact');
});

describe('tokenize: non-Latin', () => {
  eq(words('日本語 メモ'), ['日本語', 'メモ'], 'CJK words survive');
  eq(words('Привет мир'), ['привет', 'мир'], 'Cyrillic lowercases');
});

describe('trigrams', () => {
  ok(trigrams('cat').includes('cat'), 'contains the word itself');
  ok(trigrams('cat').includes('  c'), 'pads the front');
  const a = new Set(trigrams('meeting'));
  const shared = trigrams('meting').filter((t) => a.has(t)).length;
  ok(shared >= 4, `near-miss typo shares trigrams (${shared})`);
});

report('tokenize');
