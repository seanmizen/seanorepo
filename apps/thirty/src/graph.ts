import type { City } from './gen.ts';
import type { Net } from './net.ts';
import type { Params, Tier } from './params.ts';

// CSR graph. The evaluator uses only flat typed arrays, so a WASM port is a drop-in.
export type Graph = {
  n: number;
  off: Int32Array;
  to: Int32Array;
  w: Float32Array;
};
type Edges = { a: number[]; b: number[]; w: number[] };

export function csr(n: number, e: Edges): Graph {
  const off = new Int32Array(n + 1);
  for (const x of e.a) off[x + 1]++;
  for (let i = 0; i < n; i++) off[i + 1] += off[i];
  const fill = off.slice(0, n);
  const to = new Int32Array(e.a.length);
  const w = new Float32Array(e.a.length);
  e.a.forEach((x, k) => {
    const j = fill[x]++;
    to[j] = e.b[k];
    w[j] = e.w[k];
  });
  return { n, off, to, w };
}

const N8 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

// Edges between the 8 neighbours of each cell. weight() returns Infinity for no edge.
export function gridEdges(
  city: City,
  weight: (i: number, j: number, d: number) => number,
): Edges {
  const { w } = city;
  const e: Edges = { a: [], b: [], w: [] };
  for (let i = 0; i < w * w; i++) {
    const x = i % w;
    const y = Math.floor(i / w);
    for (const [dx, dy] of N8) {
      if (x + dx < 0 || x + dx >= w || y + dy < 0 || y + dy >= w) continue;
      const j = i + dy * w + dx;
      const c = weight(i, j, city.cellM * Math.hypot(dx, dy));
      if (c === Number.POSITIVE_INFINITY) continue;
      e.a.push(i);
      e.b.push(j);
      e.w.push(c);
    }
  }
  return e;
}

// Times are integers in tenths of a minute. INF plus a walk time stays below 2^32.
export const INF = 0x3fffffff;
export const tenths = (min: number) => Math.round(min * 10);

// Walk time, rounded to tenths of a minute for each edge. Tobler-style slope penalty.
// Sea blocks. Rivers cost 5x (few bridges). Symmetric. One graph for each city.
const walkCache = new WeakMap<City, Graph>();
function walkGraph(city: City) {
  let g = walkCache.get(city);
  if (!g) {
    const { elev, water } = city;
    g = csr(
      city.w * city.w,
      gridEdges(city, (i, j, d) => {
        if (water[i] === 1 || water[j] === 1) return Number.POSITIVE_INFINITY;
        const kmh = 5 * Math.exp(-3.5 * (Math.abs(elev[j] - elev[i]) / d));
        return tenths((d / (kmh * 1000)) * 60 * (water[i] || water[j] ? 5 : 1));
      }),
    );
    walkCache.set(city, g);
  }
  return g;
}

// The buffers of a search. dist is Infinity at each node that is not in seen[0, ns).
// The heap holds at most one entry for each edge, plus the source.
export type Search = {
  dist: Float64Array;
  seen: Int32Array;
  ns: number;
  hk: Float64Array;
  hv: Int32Array;
};
let buf: Search | null = null;
function buffers(n: number, m: number) {
  if (!buf || buf.dist.length < n || buf.hk.length < m + 1)
    buf = {
      dist: new Float64Array(n).fill(Number.POSITIVE_INFINITY),
      seen: new Int32Array(n),
      ns: 0,
      hk: new Float64Array(m + 1),
      hv: new Int32Array(m + 1),
    };
  return buf;
}

// The result is valid until the next search. Ties pop in the same order on each run.
export function dijkstra(
  g: Graph,
  src: number,
  cutoff = Number.POSITIVE_INFINITY,
  target = -1,
  prev?: Int32Array,
): Search {
  const { off, to, w } = g;
  const s = buffers(g.n, to.length);
  const { dist, seen, hk, hv } = s;
  for (let k = 0; k < s.ns; k++) dist[seen[k]] = Number.POSITIVE_INFINITY;
  prev?.fill(-1);
  dist[src] = 0;
  seen[0] = src;
  let ns = 1;
  hk[0] = 0;
  hv[0] = src;
  let len = 1;
  while (len) {
    const d = hk[0];
    const u = hv[0];
    len--;
    if (len) {
      // Sift the last element down from the root.
      const lk = hk[len];
      const lv = hv[len];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= len) break;
        if (c + 1 < len && hk[c + 1] < hk[c]) c++;
        if (hk[c] >= lk) break;
        hk[i] = hk[c];
        hv[i] = hv[c];
        i = c;
      }
      hk[i] = lk;
      hv[i] = lv;
    }
    if (d > dist[u]) continue;
    if (u === target || d > cutoff) break;
    for (let e = off[u]; e < off[u + 1]; e++) {
      const v = to[e];
      const nd = d + w[e];
      if (nd >= dist[v]) continue;
      if (dist[v] === Number.POSITIVE_INFINITY) seen[ns++] = v;
      dist[v] = nd;
      if (prev) prev[v] = u;
      let i = len++;
      while (i > 0 && hk[(i - 1) >> 1] > nd) {
        hk[i] = hk[(i - 1) >> 1];
        hv[i] = hv[(i - 1) >> 1];
        i = (i - 1) >> 1;
      }
      hk[i] = nd;
      hv[i] = v;
    }
  }
  s.ns = ns;
  return s;
}

// Ride time in minutes for one segment: accelerate, cruise, brake, dwell.
export function ride(d: number, t: Tier) {
  const v = t.speed / 3.6;
  const s =
    d < (v * v) / t.accel ? 2 * Math.sqrt(d / t.accel) : d / v + v / t.accel;
  return (s + t.dwell) / 60;
}

// The cells within max of walk from cell c, in cell order, and their walk times.
// The walk graph is symmetric, so these are also the times to c. One cache for each city.
type Near = { cells: Int32Array; t: Uint32Array };
const nearCache = new WeakMap<City, Map<number, Near>>();
function walkFrom(city: City, c: number, max: number) {
  const m = nearCache.get(city) ?? new Map<number, Near>();
  nearCache.set(city, m);
  const key = max * city.w * city.w + c;
  let near = m.get(key);
  if (!near) {
    const { dist, seen, ns } = dijkstra(walkGraph(city), c, max);
    const cells = seen
      .slice(0, ns)
      .filter((i) => dist[i] <= max)
      .sort();
    near = { cells, t: Uint32Array.from(cells, (i) => dist[i]) };
    m.set(key, near);
  }
  return near;
}

// S destination cells, spread evenly along the jobs CDF. No randomness.
const sampleCache = new WeakMap<City, Map<number, number[]>>();
function jobSamples(city: City, S: number) {
  const m = sampleCache.get(city) ?? new Map<number, number[]>();
  sampleCache.set(city, m);
  let out = m.get(S);
  if (!out) {
    out = [];
    let cum = 0;
    for (let i = 0, k = 0; i < city.jobs.length && k < S; i++) {
      cum += city.jobs[i];
      while (k < S && cum >= (k + 0.5) / S) {
        out.push(i);
        k++;
      }
    }
    m.set(S, out);
  }
  return out;
}

// One network, ready to score. The nodes are the stations, then the sample cells that are not stations.
// D[u * S + j]: the time from node u to sample j. cells: the cells within walk of a node, in cell order.
// The entries off[k] to off[k + 1] are the nodes near cells[k]: pairs of (u * S, walk time).
export type Prep = {
  cells: Int32Array;
  off: Uint32Array;
  ent: Uint32Array;
  D: Uint32Array;
};
let count = new Int32Array(0);
export function prep(city: City, net: Net, p: Params, S: number): Prep {
  const W = tenths(p.walk);
  const samples = jobSamples(city, S);
  const idx = new Map<number, number>();
  for (const l of net.lines)
    for (const c of l.stops) if (!idx.has(c)) idx.set(c, idx.size);
  const K = idx.size;
  for (const c of samples) if (!idx.has(c)) idx.set(c, idx.size);
  const nears = [...idx.keys()].map((c) => walkFrom(city, c, W));
  const node = (c: number) => idx.get(c) as number;
  // Calls f for each station within walk of node u.
  const stationsNear = (u: number, f: (s: number, w: number) => void) =>
    nears[u].cells.forEach((c, k) => {
      const s = idx.get(c) ?? K;
      if (s < K) f(s, nears[u].t[k]);
    });

  // The station graph: the stations, a node for each stop of each line, then a source for each sample.
  // Board = half the headway + 1 min. Alight = 0.5 min. Walk transfers of at most walk.
  const e: Edges = { a: [], b: [], w: [] };
  const add = (a: number, b: number, w: number) => {
    e.a.push(a);
    e.b.push(b);
    e.w.push(w);
  };
  let id = K;
  for (const l of net.lines) {
    const t = p.tierDefs[l.tier];
    const r = (k: number) => tenths(ride(l.segs[k], t));
    l.stops.forEach((c, k) => {
      add(node(c), id + k, tenths(t.headway / 2 + 1));
      add(id + k, node(c), 5);
      if (k > 0) {
        add(id + k - 1, id + k, r(k - 1));
        add(id + k, id + k - 1, r(k - 1));
      }
    });
    // A loop rides from the last stop to the first stop on its last segment.
    const n = l.stops.length;
    if (l.loop && n > 2) {
      add(id + n - 1, id, r(n - 1));
      add(id, id + n - 1, r(n - 1));
    }
    id += n;
  }
  for (let s = 0; s < K; s++)
    stationsNear(s, (t, w) => {
      if (t !== s) add(s, t, w);
    });
  samples.forEach((c, j) => {
    stationsNear(node(c), (t, w) => add(id + j, t, w));
  });

  // T(s, t) is symmetric: a trip has one board and one alight for each ride.
  // So D(s) = min over t of T(s, t) + walk(t, j) is one search from the source of sample j.
  const g = csr(id + S, e);
  const D = new Uint32Array(idx.size * S).fill(INF);
  samples.forEach((c, j) => {
    const { dist } = dijkstra(g, id + j);
    for (let s = 0; s < K; s++) if (dist[s] < INF) D[s * S + j] = dist[s];
    D[node(c) * S + j] = 0;
  });

  // Invert the walk lists: for each cell, the nodes within walk.
  if (count.length < city.w * city.w) count = new Int32Array(city.w * city.w);
  const cells: number[] = [];
  for (const nr of nears)
    for (const c of nr.cells) if (count[c]++ === 0) cells.push(c);
  cells.sort((a, b) => a - b);
  const off = new Uint32Array(cells.length + 1);
  cells.forEach((c, k) => {
    off[k + 1] = off[k] + count[c];
    count[c] = off[k];
  });
  const ent = new Uint32Array(2 * off[cells.length]);
  nears.forEach((nr, u) => {
    nr.cells.forEach((c, k) => {
      const x = count[c]++;
      ent[2 * x] = u * S;
      ent[2 * x + 1] = nr.t[k];
    });
  });
  for (const c of cells) count[c] = 0;
  return { cells: Int32Array.from(cells), off, ent, D };
}

// J: the pop-weighted mean score, from G in cell order. The GPU gives the same G, so the same J.
export function total(
  city: City,
  cells: Int32Array,
  G: Uint32Array,
  S: number,
  N: number,
) {
  let J = 0;
  for (let k = 0; k < cells.length; k++) J += city.pop[cells[k]] * G[k];
  return J / (S * N);
}

export type Eval = {
  J: number;
  score: Float32Array;
  within: number;
  p50: number;
  p95: number;
};

// time(cell, j) = the least walk + D(u, j) over the nodes u within walk of the cell. That is a direct walk
// (the node of sample j has D = 0), or a walk to a station, a ride and a walk from a station.
// G[k]: the sum over samples of min(N, 2N - time), and 0 from 2N. So score[c] = G / (S x N) is
// the mean over samples of 1 within N min, falling to 0 at 2N. The GPU runs the same loop.
export function evaluate(city: City, net: Net, p: Params, S: number): Eval {
  const { cells, off, ent, D } = prep(city, net, p, S);
  const N = tenths(p.N);
  const score = new Float32Array(city.w * city.w);
  const hist = new Float64Array(Math.ceil(N / 5));
  const G = new Uint32Array(cells.length);
  let within = 0;
  for (let k = 0; k < cells.length; k++) {
    const pop = city.pop[cells[k]] / S;
    for (let j = 0; j < S; j++) {
      let t = INF;
      for (let e = off[k]; e < off[k + 1]; e++)
        t = Math.min(t, ent[2 * e + 1] + D[ent[2 * e] + j]);
      if (t >= 2 * N) continue;
      G[k] += Math.min(N, 2 * N - t);
      if (t <= N) within += pop;
      hist[Math.floor(t / 10)] += pop;
    }
    score[cells[k]] = G[k] / (S * N);
  }
  const q = (f: number) => {
    let cum = 0;
    for (let m = 0; m < hist.length; m++) {
      cum += hist[m];
      if (cum >= f) return m;
    }
    return Number.POSITIVE_INFINITY;
  };
  return {
    J: total(city, cells, G, S, N),
    score,
    within,
    p50: q(0.5),
    p95: q(0.95),
  };
}
