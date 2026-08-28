// Graph layout tests.
//
// A layout has no single correct answer, so these assert the properties that
// make it usable: everything lands on screen, nothing overlaps exactly, the
// result is reproducible, and connected nodes end up nearer each other than
// unconnected ones.
import { describe, eq, ok, report } from './harness.mjs';
import { layoutGraph } from '../src/core/layout.ts';

const W = 360;
const H = 480;
const opts = { width: W, height: H, iterations: 160 };

const chain = (n) => {
  const ids = Array.from({ length: n }, (_, i) => 'n' + i);
  const edges = ids.slice(1).map((id, i) => ({ from: ids[i], to: id }));
  return { ids, edges };
};

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

describe('degenerate inputs', () => {
  eq(layoutGraph([], [], opts), [], 'empty graph');
  const one = layoutGraph(['a'], [], opts);
  eq(one.length, 1, 'single node');
  ok(Number.isFinite(one[0].x) && Number.isFinite(one[0].y), 'single node has real coordinates');
  const orphans = layoutGraph(['a', 'b', 'c'], [], opts);
  eq(orphans.length, 3, 'no edges is fine');
  ok(orphans.every((n) => n.weight === 0), 'no edges means zero weight');
});

describe('edges referencing missing nodes are ignored', () => {
  const out = layoutGraph(['a', 'b'], [{ from: 'a', to: 'ghost' }, { from: 'a', to: 'b' }], opts);
  eq(out.length, 2, 'still two nodes');
  eq(out.find((n) => n.id === 'a').weight, 1, 'only the real edge counts');
  const selfLoop = layoutGraph(['a'], [{ from: 'a', to: 'a' }], opts);
  eq(selfLoop[0].weight, 0, 'self loops are not edges');
});

describe('everything stays on screen', () => {
  for (const size of [2, 5, 20, 60]) {
    const { ids, edges } = chain(size);
    const out = layoutGraph(ids, edges, opts);
    const inside = out.every((n) => n.x >= 0 && n.x <= W && n.y >= 0 && n.y <= H);
    ok(inside, `${size} nodes stay inside the viewport`);
    ok(out.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)), `${size} nodes have finite positions`);
  }
});

describe('no two nodes land on the same point', () => {
  const { ids, edges } = chain(30);
  const out = layoutGraph(ids, edges, opts);
  let closest = Infinity;
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) closest = Math.min(closest, dist(out[i], out[j]));
  }
  ok(closest > 1, `closest pair is ${closest.toFixed(1)}px apart`);
});

describe('deterministic', () => {
  const { ids, edges } = chain(24);
  const a = layoutGraph(ids, edges, opts);
  const b = layoutGraph(ids, edges, opts);
  eq(a, b, 'same input gives the same layout');
  const c = layoutGraph(ids, edges, { ...opts, seed: 99 });
  ok(JSON.stringify(a) !== JSON.stringify(c), 'a different seed gives a different layout');
});

describe('structure is visible in the result', () => {
  // Two tight clusters joined by nothing should end up separated.
  const ids = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3'];
  const edges = [
    { from: 'a1', to: 'a2' }, { from: 'a2', to: 'a3' }, { from: 'a3', to: 'a1' },
    { from: 'b1', to: 'b2' }, { from: 'b2', to: 'b3' }, { from: 'b3', to: 'b1' },
  ];
  const out = layoutGraph(ids, edges, { ...opts, iterations: 300 });
  const at = (id) => out.find((n) => n.id === id);
  const withinA = (dist(at('a1'), at('a2')) + dist(at('a2'), at('a3')) + dist(at('a1'), at('a3'))) / 3;
  let across = 0;
  for (const a of ['a1', 'a2', 'a3']) for (const b of ['b1', 'b2', 'b3']) across += dist(at(a), at(b));
  across /= 9;
  ok(across > withinA, `clusters separate (within ${withinA.toFixed(0)}px, across ${across.toFixed(0)}px)`);

  // Degree is reported so the view can size and label nodes.
  eq(at('a1').weight, 2, 'degree counted');
});

describe('hub placement', () => {
  // A star: the centre should sit nearer the middle of the canvas than the tips.
  const ids = ['hub', ...Array.from({ length: 10 }, (_, i) => 't' + i)];
  const edges = ids.slice(1).map((id) => ({ from: 'hub', to: id }));
  const out = layoutGraph(ids, edges, { ...opts, iterations: 300 });
  const hub = out.find((n) => n.id === 'hub');
  const centre = { x: W / 2, y: H / 2 };
  const tips = out.filter((n) => n.id !== 'hub');
  const avgTip = tips.reduce((a, n) => a + dist(n, centre), 0) / tips.length;
  ok(dist(hub, centre) < avgTip, `hub is central (${dist(hub, centre).toFixed(0)} vs ${avgTip.toFixed(0)})`);
  eq(hub.weight, 10, 'hub degree');
});

describe('performance', () => {
  const { ids, edges } = chain(90);
  const t = Date.now();
  layoutGraph(ids, edges, { width: W, height: H });
  const ms = Date.now() - t;
  ok(ms < 1500, `90 nodes lay out in ${ms}ms`);
});

report('layout');
