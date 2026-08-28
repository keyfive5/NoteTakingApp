// Performance floor for search-as-you-type.
//
// The budget that matters: a keystroke must produce results inside one 60fps
// frame (16.7ms) on a phone. This machine is faster than a phone, so the target
// here is deliberately stricter — a few milliseconds — to leave headroom.
import { buildIndex, search } from '../src/core/search/engine.ts';
import { extractLinkKeys, extractTags } from '../src/core/links.ts';
import { emptyNote } from '../src/core/types.ts';

const COMMON = ('project meeting budget roadmap client invoice grocery recipe sourdough running ' +
  'architecture refactor session token deadline offsite kyoto lisbon montreal reading piranesi ' +
  'dentist appointment mortgage insurance renewal passport flight hotel booking receipt warranty ' +
  'quarterly planning retrospective standup migration database index latency throughput cache ' +
  'garden tomato basil watering schedule laundry rotation dishwasher filter replacement').split(' ');

let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

// Real note collections have a large vocabulary with a Zipf-shaped frequency
// curve: a few hundred words carry most of the text and a long tail appears once
// or twice. Sampling from a 50-word list instead would put every note in every
// posting list — a worst case that flatters nothing and measures nothing real.
const SYLL = ['ka', 'ro', 'mi', 'ta', 'len', 'sor', 'bel', 'nu', 'dra', 'fi', 'sto', 'vek', 'ar', 'plu', 'zen'];
const VOCAB = [...COMMON];
while (VOCAB.length < 8000) {
  let w = '';
  for (let i = 0, n = 2 + Math.floor(rnd() * 3); i < n; i++) w += SYLL[Math.floor(rnd() * SYLL.length)];
  VOCAB.push(w + VOCAB.length.toString(36));
}
// Zipf: rank r is drawn with probability proportional to 1/r.
const CDF = new Float64Array(VOCAB.length);
let acc = 0;
for (let i = 0; i < VOCAB.length; i++) CDF[i] = acc += 1 / (i + 1);
const TOTAL = acc;
const pick = () => {
  const target = rnd() * TOTAL;
  let lo = 0;
  let hi = CDF.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (CDF[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return VOCAB[lo];
};

function makeCorpus(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const note = emptyNote('n' + i, Date.now() - Math.floor(rnd() * 6e10));
    note.title = `${pick()} ${pick()} ${pick()}`;
    const paras = [];
    for (let p = 0; p < 3 + Math.floor(rnd() * 6); p++) {
      const words = [];
      for (let w = 0; w < 25 + Math.floor(rnd() * 60); w++) words.push(pick());
      paras.push(words.join(' '));
    }
    paras.push(`#${pick()}/${pick()}`);
    if (i > 0 && rnd() > 0.6) paras.push(`See [[${out[Math.floor(rnd() * out.length)].title}]]`);
    note.body = paras.join('\n\n');
    note.tags = extractTags(note.body);
    note.links = extractLinkKeys(note.body);
    note.updatedAt = note.createdAt;
    out.push(note);
  }
  return out;
}

const QUERIES = ['b', 'bu', 'bud', 'budg', 'budge', 'budget', 'budget planning',
  'meting', 'arcitecture', 'sourdogh', 'light bulb', 'tag:garden', '"quarterly planning"',
  'is:todo', 'client invoice deadline', 'kyoto'];

console.log(`vocabulary: ${VOCAB.length} words, Zipf-sampled`);
console.log("size    build      p50      p95      max     bytes/note");
for (const size of [200, 1000, 5000, 20000]) {
  const corpus = makeCorpus(size);
  const notes = new Map(corpus.map((n) => [n.id, n]));

  const t0 = process.hrtime.bigint();
  const index = buildIndex(corpus);
  const buildMs = Number(process.hrtime.bigint() - t0) / 1e6;

  // Warm up, then measure every query several times.
  for (const q of QUERIES) search(index, notes, q);
  const times = [];
  for (let rep = 0; rep < 6; rep++) {
    for (const q of QUERIES) {
      const s = process.hrtime.bigint();
      search(index, notes, q, { limit: 50 });
      times.push(Number(process.hrtime.bigint() - s) / 1e6);
    }
  }
  times.sort((a, b) => a - b);
  const at = (p) => times[Math.min(times.length - 1, Math.floor(times.length * p))];
  const bytes = corpus.reduce((a, n) => a + n.title.length + n.body.length, 0);

  console.log(
    `${String(size).padEnd(7)} ${buildMs.toFixed(0).padStart(5)}ms ` +
    `${at(0.5).toFixed(2).padStart(7)}ms ${at(0.95).toFixed(2).padStart(6)}ms ` +
    `${times[times.length - 1].toFixed(2).padStart(6)}ms ${Math.round(bytes / size).toString().padStart(9)}`,
  );
}
