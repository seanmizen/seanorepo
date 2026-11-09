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
// One graph for each city. The transit graph of each network adds to it.
const walkCache = new WeakMap<City, Graph>();
export function walkGraph(city: City) {
  let g = walkCache.get(city);
  if (!g) {
    const { elev, water } = city;
    g = csr(
      city.w * city.w,
      gridEdges(city, (i, j, d) => {
        if (water[i] === 1 || water[j] === 1) return Number.POSITIVE_INFINITY;
        const kmh = 5 * Math.exp(-3.5 * (Math.abs(elev[j] - elev[i]) / d));
        return (d / (kmh * 1000)) * 60 * (water[i] || water[j] ? 5 : 1);
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

// Search over the edges of all the graphs in gs. Graph k has edges from nodes below gs[k].n.
// The result is valid until the next search. Ties pop in the same order on each run.
export function dijkstra(
  gs: Graph[],
  src: number,
  cutoff = Number.POSITIVE_INFINITY,
  target = -1,
  prev?: Int32Array,
): Search {
  let n = 0;
  let m = 0;
  for (const g of gs) {
    n = Math.max(n, g.n);
    m += g.to.length;
  }
  const s = buffers(n, m);
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
    for (const { n, off, to, w } of gs) {
      if (u >= n) continue;
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

// Each stop of each line is its own node. Board = half the headway + 1 min. Transfers need no code.
// Only the line nodes and line edges. The search adds the walk graph.
function transitGraph(city: City, net: Net, p: Params): Graph {
  const e: Edges = { a: [], b: [], w: [] };
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
  const gs = [walkGraph(city), transitGraph(city, net, p)];
  const n = city.w * city.w;
  const cut = 2 * p.N;
  const score = new Float32Array(n);
  const hist = new Float64Array(cut);
  const cells = new Int32Array(n);
  let within = 0;
  const samples = jobSamples(city, S);
  for (const s of samples) {
    const { dist, seen, ns } = dijkstra(gs, s, cut);
    // Only cells within the cutoff add to score, within and hist. In cell order, so each sum is the same.
    let k = 0;
    for (let j = 0; j < ns; j++)
      if (seen[j] < n && dist[seen[j]] < cut) cells[k++] = seen[j];
    for (const c of cells.subarray(0, k).sort()) {
      const t = dist[c];
      const pop = city.pop[c] / samples.length;
      score[c] += (t <= p.N ? 1 : 1 - (t - p.N) / p.N) / samples.length;
      if (t <= p.N) within += pop;
      hist[Math.floor(t)] += pop;
    }
  }
  let J = 0;
  for (let c = 0; c < n; c++) J += city.pop[c] * score[c];
  const q = (f: number) => {
    let cum = 0;
    for (let m = 0; m < cut; m++) {
      cum += hist[m];
      if (cum >= f) return m;
    }
    return Number.POSITIVE_INFINITY;
  };
  return { J, score, within, p50: q(0.5), p95: q(0.95) };
}
