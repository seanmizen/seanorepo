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

// Walk time in minutes. Tobler-style slope penalty. Sea blocks. Rivers cost 5x (few bridges).
const walkCache = new WeakMap<City, Edges>();
const walkEdges = (city: City) => {
  let e = walkCache.get(city);
  if (!e) {
    const { elev, water } = city;
    e = gridEdges(city, (i, j, d) => {
      if (water[i] === 1 || water[j] === 1) return Number.POSITIVE_INFINITY;
      const kmh = 5 * Math.exp(-3.5 * (Math.abs(elev[j] - elev[i]) / d));
      return (d / (kmh * 1000)) * 60 * (water[i] || water[j] ? 5 : 1);
    });
    walkCache.set(city, e);
  }
  return e;
};

export function dijkstra(
  g: Graph,
  src: number,
  dist: Float64Array,
  cutoff = Number.POSITIVE_INFINITY,
  target = -1,
  prev?: Int32Array,
) {
  dist.fill(Number.POSITIVE_INFINITY);
  prev?.fill(-1);
  dist[src] = 0;
  const hk = [0];
  const hv = [src];
  while (hk.length) {
    const d = hk[0];
    const u = hv[0];
    const lk = hk.pop() as number;
    const lv = hv.pop() as number;
    if (hk.length) {
      // Sift the last element down from the root.
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= hk.length) break;
        if (c + 1 < hk.length && hk[c + 1] < hk[c]) c++;
        if (hk[c] >= lk) break;
        hk[i] = hk[c];
        hv[i] = hv[c];
        i = c;
      }
      hk[i] = lk;
      hv[i] = lv;
    }
    if (d > dist[u]) continue;
    if (u === target || d > cutoff) return;
    for (let e = g.off[u]; e < g.off[u + 1]; e++) {
      const v = g.to[e];
      const nd = d + g.w[e];
      if (nd >= dist[v]) continue;
      dist[v] = nd;
      if (prev) prev[v] = u;
      let i = hk.length;
      while (i > 0 && hk[(i - 1) >> 1] > nd) {
        hk[i] = hk[(i - 1) >> 1];
        hv[i] = hv[(i - 1) >> 1];
        i = (i - 1) >> 1;
      }
      hk[i] = nd;
      hv[i] = v;
    }
  }
}

// Ride time in minutes for one segment: accelerate, cruise, brake, dwell.
export function ride(d: number, t: Tier) {
  const v = t.speed / 3.6;
  const s =
    d < (v * v) / t.accel ? 2 * Math.sqrt(d / t.accel) : d / v + v / t.accel;
  return (s + t.dwell) / 60;
}

// Each stop of each line is its own node. Board = half the headway + 1 min. Transfers need no code.
function transitGraph(city: City, net: Net, p: Params): Graph {
  const base = walkEdges(city);
  const e: Edges = { a: [...base.a], b: [...base.b], w: [...base.w] };
  const add = (a: number, b: number, w: number) => {
    e.a.push(a);
    e.b.push(b);
    e.w.push(w);
  };
  let id = city.w * city.w;
  for (const l of net.lines) {
    const t = p.tierDefs[l.tier];
    l.stops.forEach((c, k) => {
      add(c, id + k, t.headway / 2 + 1);
      add(id + k, c, 0.5);
      if (k > 0) {
        const r = ride(l.segs[k - 1], t);
        add(id + k - 1, id + k, r);
        add(id + k, id + k - 1, r);
      }
    });
    // A loop rides from the last stop to the first stop on its last segment.
    const n = l.stops.length;
    if (l.loop && n > 2) {
      const r = ride(l.segs[n - 1], t);
      add(id + n - 1, id, r);
      add(id, id + n - 1, r);
    }
    id += n;
  }
  return csr(id, e);
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

export type Eval = {
  J: number;
  score: Float32Array;
  within: number;
  p50: number;
  p95: number;
};

// score[c]: mean over job samples of 1 within N min, falling to 0 at 2N. J: pop-weighted mean score.
// Travel times are symmetric (one board and one alight per ride), so a search from each destination is enough.
export function evaluate(city: City, net: Net, p: Params, S: number): Eval {
  const g = transitGraph(city, net, p);
  const n = city.w * city.w;
  const cut = 2 * p.N;
  const score = new Float32Array(n);
  const hist = new Float64Array(cut + 2);
  const dist = new Float64Array(g.n);
  let within = 0;
  const samples = jobSamples(city, S);
  for (const s of samples) {
    dijkstra(g, s, dist, cut);
    for (let c = 0; c < n; c++) {
      const t = dist[c];
      const pop = city.pop[c] / samples.length;
      score[c] +=
        (t <= p.N ? 1 : t < cut ? 1 - (t - p.N) / p.N : 0) / samples.length;
      if (t <= p.N) within += pop;
      hist[t < cut ? Math.floor(t) : cut + 1] += pop;
    }
  }
  let J = 0;
  for (let c = 0; c < n; c++) J += city.pop[c] * score[c];
  const q = (f: number) => {
    let cum = 0;
    for (let m = 0; m < hist.length; m++) {
      cum += hist[m];
      if (cum >= f) return m < cut ? m : Number.POSITIVE_INFINITY;
    }
    return Number.POSITIVE_INFINITY;
  };
  return { J, score, within, p50: q(0.5), p95: q(0.95) };
}
