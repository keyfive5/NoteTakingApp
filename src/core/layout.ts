// Force-directed layout for the connections view.
//
// A deterministic, fixed-iteration simulation rather than an animated one: the
// graph is computed once when the screen opens and drawn static. An animated
// simulation looks impressive for five seconds and then costs battery forever,
// and a note graph is something people glance at, not watch.

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  /** Degree, used for node size and to anchor hubs nearer the centre. */
  weight: number;
}

export interface LayoutEdge {
  from: string;
  to: string;
}

/** Keeps nodes and their labels clear of the canvas edge. */
const MARGIN = 34;

export interface LayoutOptions {
  width: number;
  height: number;
  iterations?: number;
  /** Seed for the initial placement, so the same graph always looks the same. */
  seed?: number;
}

/**
 * Lay out a graph with repulsion between all nodes, springs along edges, and a
 * weak pull toward the centre so disconnected components do not drift away.
 */
export function layoutGraph(
  ids: string[],
  edges: LayoutEdge[],
  opts: LayoutOptions,
): LayoutNode[] {
  const { width, height } = opts;
  const iterations = opts.iterations ?? 220;
  const n = ids.length;
  if (n === 0) return [];

  const index = new Map(ids.map((id, i) => [id, i]));
  const degree = new Float64Array(n);
  const links: [number, number][] = [];
  for (const e of edges) {
    const a = index.get(e.from);
    const b = index.get(e.to);
    if (a === undefined || b === undefined || a === b) continue;
    links.push([a, b]);
    degree[a]++;
    degree[b]++;
  }

  // Deterministic start: place nodes on a spiral, so runs are reproducible and
  // no two nodes begin at the same point (which would make repulsion NaN).
  let seed = opts.seed ?? 1;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.38;
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2 * 3.4;
    const r = radius * Math.sqrt((i + 0.5) / n) * (0.75 + rnd() * 0.5);
    xs[i] = cx + Math.cos(angle) * r;
    ys[i] = cy + Math.sin(angle) * r;
  }

  const area = width * height;
  // Fruchterman–Reingold's ideal edge length for this many nodes in this area.
  const k = Math.sqrt(area / n) * 0.55;
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  let temperature = Math.min(width, height) * 0.14;
  const cooling = temperature / (iterations + 1);

  for (let step = 0; step < iterations; step++) {
    dx.fill(0);
    dy.fill(0);

    // Repulsion. O(n^2), which is fine: this view caps the node count well
    // below the point where a quadtree would earn its complexity.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let ux = xs[i] - xs[j];
        let uy = ys[i] - ys[j];
        let d2 = ux * ux + uy * uy;
        if (d2 < 0.01) {
          // Coincident nodes: nudge them apart deterministically.
          ux = (i % 7) - 3 + 0.5;
          uy = (j % 5) - 2 + 0.5;
          d2 = ux * ux + uy * uy;
        }
        const d = Math.sqrt(d2);
        const force = (k * k) / d;
        const fx = (ux / d) * force;
        const fy = (uy / d) * force;
        dx[i] += fx;
        dy[i] += fy;
        dx[j] -= fx;
        dy[j] -= fy;
      }
    }

    // Attraction along edges.
    for (const [a, b] of links) {
      const ux = xs[a] - xs[b];
      const uy = ys[a] - ys[b];
      const d = Math.sqrt(ux * ux + uy * uy) || 0.01;
      const force = (d * d) / k;
      const fx = (ux / d) * force;
      const fy = (uy / d) * force;
      dx[a] -= fx;
      dy[a] -= fy;
      dx[b] += fx;
      dy[b] += fy;
    }

    // Gravity, stronger for well-connected nodes so the linked cluster — the
    // part worth looking at — settles in the middle and the unconnected notes
    // arrange themselves around the outside.
    //
    // These constants were chosen by measuring, not by eye: on a representative
    // graph (a four-note cluster plus six orphans) they put the cluster centroid
    // ~53px off centre with ~87px of clearance between the closest pair. Weaker
    // gravity pushed the cluster into a corner; much stronger gravity centred it
    // but squeezed the spread out of the picture.
    for (let i = 0; i < n; i++) {
      dx[i] += (cx - xs[i]) * 0.35 * (1 + degree[i] * 0.8);
      dy[i] += (cy - ys[i]) * 0.35 * (1 + degree[i] * 0.8);
    }

    // Apply, limited by the current temperature so the layout settles.
    for (let i = 0; i < n; i++) {
      const d = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]) || 1;
      const limit = Math.min(d, temperature);
      xs[i] += (dx[i] / d) * limit;
      ys[i] += (dy[i] / d) * limit;
      // Confine to the frame every step.
      //
      // The alternative — let the simulation run free and scale the result to
      // fit at the end — quietly destroys the picture. Unconnected notes have
      // nothing but weak gravity holding them, so they drift out to many times
      // the canvas size, and the final rescale then crushes the genuinely
      // interesting cluster down to a few unreadable pixels. Confining as we go
      // keeps distances meaningful in the units they are drawn in.
      xs[i] = Math.min(width - MARGIN, Math.max(MARGIN, xs[i]));
      ys[i] = Math.min(height - MARGIN, Math.max(MARGIN, ys[i]));
    }
    temperature -= cooling;
  }

  return ids.map((id, i) => ({ id, x: xs[i], y: ys[i], weight: degree[i] }));
}
