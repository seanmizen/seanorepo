import { type City, cellDist, mulberry32, type Rng } from './gen.ts';
import { csr, dijkstra, evaluate, type Graph, gridEdges } from './graph.ts';
import type { Params } from './params.ts';

export type Line = {
  tier: string;
  path: number[];
  stops: number[];
  segs: number[];
  cost: number;
};
export type Net = { lines: Line[] };
export type Ctx = {
  city: City;
  p: Params;
  rng: Rng;
  frac: number;
  J: (n: Net) => number;
};
// One step of an algorithm. Add one: write the function, add it to ALGOS.
export type Algo = (net: Net, ctx: Ctx) => Net;

// Build weight in metres: slope and water make a line cost more.
const buildW = (city: City, i: number, j: number, d: number) =>
  d *
  (1 + 10 * (Math.abs(city.elev[j] - city.elev[i]) / d)) *
  (city.water[i] || city.water[j] ? 4 : 1);

const buildCache = new WeakMap<City, Graph>();
function route(city: City, a: number, b: number) {
  let g = buildCache.get(city);
  if (!g) {
    g = csr(
      city.w * city.w,
      gridEdges(city, (i, j, d) => buildW(city, i, j, d)),
    );
    buildCache.set(city, g);
  }
  const prev = new Int32Array(g.n);
  dijkstra(g, a, new Float64Array(g.n), Number.POSITIVE_INFINITY, b, prev);
  const path = [b];
  while (path[0] !== a) {
    if (prev[path[0]] < 0) return null;
    path.unshift(prev[path[0]]);
  }
  return path;
}

// Stops at the tier spacing, on land only. The last stop is the end of the path.
// If "at" is given, the stops are at those path indices only.
// A new station costs t.station. A stop at a station in "have" costs p.interchange of that.
// The cost is fixed when the line is made. It does not change when other lines change.
function makeLine(
  city: City,
  p: Params,
  tier: string,
  path: number[],
  have: Set<number>,
  at?: Set<number>,
): Line {
  const t = p.tierDefs[tier];
  const stops = [path[0]];
  const segs: number[] = [];
  let since = 0;
  let cost = 0;
  for (let k = 1; k < path.length; k++) {
    const d = cellDist(path[k - 1], path[k], city.w) * city.cellM;
    since += d;
    cost += buildW(city, path[k - 1], path[k], d);
    const end = k === path.length - 1;
    if (at) {
      if (at.has(k)) {
        stops.push(path[k]);
        segs.push(since);
        since = 0;
      }
    } else if (end && since < t.spacing / 2 && stops.length > 1) {
      stops[stops.length - 1] = path[k];
      segs[segs.length - 1] += since;
    } else if (end || (since >= t.spacing && !city.water[path[k]])) {
      stops.push(path[k]);
      segs.push(since);
      since = 0;
    }
  }
  let stations = 0;
  for (const c of stops)
    stations += have.has(c) ? t.station * p.interchange : t.station;
  return { tier, path, stops, segs, cost: (cost / 1000) * t.cost + stations };
}

// The line with each stop moved to the nearest station within snap x spacing.
// The route goes through each stop. Null if no stop moves or a part has no route.
function snapped(city: City, p: Params, l: Line, have: Set<number>) {
  const r = p.snap * p.tierDefs[l.tier].spacing;
  const ways: number[] = [];
  let moved = false;
  for (const s of l.stops) {
    let best = s;
    let bd = r;
    for (const c of have) {
      const d = cellDist(s, c, city.w) * city.cellM;
      if (d <= bd && !city.water[c]) [best, bd] = [c, d];
    }
    moved ||= best !== s;
    if (best !== ways[ways.length - 1]) ways.push(best);
  }
  if (!moved || ways.length < 2) return null;
  const path = [ways[0]];
  const at = new Set<number>();
  for (let k = 1; k < ways.length; k++) {
    const part = route(city, ways[k - 1], ways[k]);
    if (!part) return null;
    path.push(...part.slice(1));
    at.add(path.length - 1);
  }
  return makeLine(city, p, l.tier, path, have, at);
}

const cdfCache = new WeakMap<Float32Array, Float64Array>();
function sample(a: Float32Array, r: number) {
  let c = cdfCache.get(a);
  if (!c) {
    c = new Float64Array(a.length);
    for (let i = 0, s = 0; i < a.length; i++) c[i] = s += a[i];
    cdfCache.set(a, c);
  }
  let lo = 0;
  let hi = c.length - 1;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (c[m] < r) lo = m + 1;
    else hi = m;
  }
  return lo;
}

const add = (net: Net, l: Line): Net => ({ lines: [...net.lines, l] });
const last = (net: Net) => net.lines[net.lines.length - 1];

// The network with one more random line, from a home-weighted cell to a job-weighted cell.
// The line fits in the budget left. The new line is the last line.
// If snap > 0, a snapped variant is made too. The one with more gain per cost is kept.
function candidate(c: Ctx, net: Net, left: number): Net | null {
  const { city, p, rng } = c;
  const have = new Set(net.lines.flatMap((l) => l.stops));
  for (let tries = 0; tries < 20; tries++) {
    const tier = p.tiers[Math.floor(rng() * p.tiers.length)];
    const t = p.tierDefs[tier];
    const a = sample(city.pop, rng());
    const b = sample(city.jobs, rng());
    const km = (cellDist(a, b, city.w) * city.cellM) / 1000;
    if (km < t.minKm || km > t.maxKm) continue;
    const path = route(city, a, b);
    if (!path) continue;
    const plain = makeLine(city, p, tier, path, have);
    const ns = [plain, p.snap > 0 ? snapped(city, p, plain, have) : null]
      .filter((l): l is Line => !!l && l.cost <= left && l.stops.length > 1)
      .map((l) => add(net, l));
    if (ns.length < 2) {
      if (ns.length) return ns[0];
      continue;
    }
    const gain = (n: Net) => (c.J(n) - c.J(net)) / last(n).cost;
    return gain(ns[1]) > gain(ns[0]) ? ns[1] : ns[0];
  }
  return null;
}

export const spent = (net: Net) => net.lines.reduce((s, l) => s + l.cost, 0);
const without = (net: Net, k: number): Net => ({
  lines: net.lines.filter((_, i) => i !== k),
});

export const ALGOS: Record<string, Algo> = {
  // Baseline: add a random line.
  random: (net, c) => {
    return candidate(c, net, c.p.budget - spent(net)) ?? net;
  },
  // Add the candidate with the best gain per cost. Adding a line never makes a trip slower.
  greedy: (net, c) => {
    const j0 = c.J(net);
    let best = net;
    let gain = 0;
    for (let i = 0; i < c.p.candidates; i++) {
      const n2 = candidate(c, net, c.p.budget - spent(net));
      if (!n2) continue;
      const g = (c.J(n2) - j0) / last(n2).cost;
      if (g > gain) [best, gain] = [n2, g];
    }
    return best;
  },
  // Add, remove or replace one line. Sometimes keep a worse network, less often as the run continues.
  anneal: (net, c) => {
    const r = c.rng();
    const k = Math.floor(c.rng() * net.lines.length);
    let n2: Net = net;
    if (r < 0.4 || !net.lines.length)
      n2 = candidate(c, net, c.p.budget - spent(net)) ?? net;
    else if (r < 0.7) n2 = without(net, k);
    else {
      const rest = without(net, k);
      n2 = candidate(c, rest, c.p.budget - spent(rest)) ?? net;
    }
    const j0 = c.J(net);
    const d = (c.J(n2) - j0) / Math.max(j0, 1e-9);
    const T = 0.02 * (1 - c.frac) + 1e-6;
    return d > 0 || c.rng() < Math.exp(d / T) ? n2 : net;
  },
};

export type Snap = {
  step: number;
  total: number;
  algo: string;
  net: Net;
  J: number;
};

// Runs the chain. Each segment ends at the best network it saw.
export function* run(city: City, p: Params): Generator<Snap> {
  const memo = new WeakMap<Net, number>();
  const J = (n: Net) => {
    const v = memo.get(n) ?? evaluate(city, n, p, 32).J;
    memo.set(n, v);
    return v;
  };
  const rng = mulberry32(p.run ^ 0x5bd1e995);
  const total = p.chain.reduce((s, [, k]) => s + k, 0);
  let net: Net = { lines: [] };
  let step = 0;
  yield { step, total, algo: '', net, J: J(net) };
  for (const [algo, count] of p.chain) {
    let best = net;
    for (let k = 0; k < count; k++) {
      net = ALGOS[algo](net, { city, p, rng, frac: k / count, J });
      if (J(net) > J(best)) best = net;
      if (k === count - 1) net = best;
      yield { step: ++step, total, algo, net, J: J(net) };
    }
  }
}

export function hashNet(net: Net) {
  let h = 0x811c9dc5;
  for (const ch of net.lines
    .map((l) => `${l.tier}:${l.stops.join(',')}`)
    .join('|'))
    h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}
