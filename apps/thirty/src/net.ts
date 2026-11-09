import { type City, cellDist, mulberry32, type Rng } from './gen.ts';
import {
  csr,
  dijkstra,
  evaluate,
  type Graph,
  gridEdges,
  samples,
} from './graph.ts';
import type { Params } from './params.ts';

// shape: the generator that made the line (a key of SHAPES), or 'join'.
// loop: the last stop connects to the first stop. segs then has one entry per stop.
export type Line = {
  tier: string;
  shape: string;
  loop: boolean;
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
// A step can return a Batch: the networks it scores, and the rest of the step.
// run() yields the networks, so a caller can score them in parallel before then() runs.
export type Batch = { score: Net[]; then: () => Net };
export type Algo = (net: Net, ctx: Ctx) => Net | Batch;

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
  dijkstra(g, a, Number.POSITIVE_INFINITY, b, prev);
  const path = [b];
  while (path[0] !== a) {
    if (prev[path[0]] < 0) return null;
    path.unshift(prev[path[0]]);
  }
  return path;
}

// The path through each of the ways, in order, on the cheapest route between each pair.
// "at" holds the path index of each way after the first. Null if a part has no route.
function through(city: City, ways: number[]) {
  const path = [ways[0]];
  const at = new Set<number>();
  for (let k = 1; k < ways.length; k++) {
    const part = route(city, ways[k - 1], ways[k]);
    if (!part) return null;
    path.push(...part.slice(1));
    at.add(path.length - 1);
  }
  // A path that visits a cell twice runs over its own track. Only a loop may end where it starts.
  const loop = ways[0] === ways[ways.length - 1];
  if (new Set(path).size < path.length - (loop ? 1 : 0)) return null;
  return { path, at };
}

// Stops at the tier spacing, on land only. The last stop is the end of the path.
// "at": path indices that must be stops. With "only", the stops are at those indices only.
// A spacing stop less than half a spacing before a must-stop moves to that must-stop.
// A loop path ends at its first cell. That last stop is removed, and its segment closes the loop.
// A new station costs t.station. A stop at a station in "have" costs p.interchange of that.
// The cost is fixed when the line is made. It does not change when other lines change.
function makeLine(
  city: City,
  p: Params,
  tier: string,
  path: number[],
  have: Set<number>,
  shape: string,
  loop: boolean,
  at?: Set<number>,
  only = false,
): Line {
  const t = p.tierDefs[tier];
  const stops = [path[0]];
  const segs: number[] = [];
  let since = 0;
  let cost = 0;
  let fixed = true; // the last stop is a must-stop
  for (let k = 1; k < path.length; k++) {
    const d = cellDist(path[k - 1], path[k], city.w) * city.cellM;
    since += d;
    cost += buildW(city, path[k - 1], path[k], d);
    const must = k === path.length - 1 || !!at?.has(k);
    if (!only && must && since < t.spacing / 2 && !fixed) {
      stops[stops.length - 1] = path[k];
      segs[segs.length - 1] += since;
      since = 0;
      fixed = true;
    } else if (must || (!only && since >= t.spacing && !city.water[path[k]])) {
      stops.push(path[k]);
      segs.push(since);
      since = 0;
      fixed = must;
    }
  }
  if (loop) stops.pop();
  let stations = 0;
  for (const c of stops)
    stations += have.has(c) ? t.station * p.interchange : t.station;
  const total = (cost / 1000) * t.cost + stations;
  return { tier, shape, loop, path, stops, segs, cost: total };
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
  if (!moved || ways.length < (l.loop ? 3 : 2)) return null;
  if (l.loop && ways[ways.length - 1] !== ways[0]) ways.push(ways[0]);
  const t = through(city, ways);
  if (!t) return null;
  return makeLine(city, p, l.tier, t.path, have, l.shape, l.loop, t.at, true);
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

// The turn at b in degrees, from the direction a to b to the direction b to c.
// 0 is straight on. 180 is a full reverse.
export function turnAt(w: number, a: number, b: number, c: number) {
  const [ux, uy] = [(b % w) - (a % w), Math.floor(b / w) - Math.floor(a / w)];
  const [vx, vy] = [(c % w) - (b % w), Math.floor(c / w) - Math.floor(b / w)];
  return (
    (Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)) * 180) / Math.PI
  );
}

// The jobs-weighted mean position, as [x, y] in cells.
const centreCache = new WeakMap<City, [number, number]>();
export function centre(city: City): [number, number] {
  let m = centreCache.get(city);
  if (!m) {
    let [x, y] = [0, 0];
    city.jobs.forEach((j, i) => {
      x += j * (i % city.w);
      y += j * Math.floor(i / city.w);
    });
    m = [x, y];
    centreCache.set(city, m);
  }
  return m;
}

// The land cell with the most homes within 2 cells of (x, y). -1 if there is no land cell.
function homeNear(city: City, x: number, y: number) {
  const { w } = city;
  let best = -1;
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const [cx, cy] = [Math.round(x) + dx, Math.round(y) + dy];
      if (cx < 0 || cy < 0 || cx >= w || cy >= w) continue;
      const c = cy * w + cx;
      if (!city.water[c] && (best < 0 || city.pop[c] > city.pop[best]))
        best = c;
    }
  return best;
}

// A line through the ways, with a stop at each way. The routed length must be from
// minKm to 2 x maxKm.
function routed(
  city: City,
  p: Params,
  tier: string,
  ways: number[],
  have: Set<number>,
  shape: string,
  loop = false,
) {
  const t = p.tierDefs[tier];
  const r = through(city, ways);
  if (!r) return null;
  let m = 0;
  for (let k = 1; k < r.path.length; k++)
    m += cellDist(r.path[k - 1], r.path[k], city.w) * city.cellM;
  if (m / 1000 < t.minKm || m / 1000 > 2 * t.maxKm) return null;
  return makeLine(city, p, tier, r.path, have, shape, loop, r.at);
}

// Line shapes. Each makes one random line of the tier, or null if the try fails.
// Add one: write the function, add it here, use it in the shapes parameter.
type Shape = (
  city: City,
  p: Params,
  rng: Rng,
  tier: string,
  have: Set<number>,
) => Line | null;
export const SHAPES: Record<string, Shape> = {
  // From a home-weighted cell A to a job-weighted cell B. The check is on the distance from A to B.
  line: (city, p, rng, tier, have) => {
    const t = p.tierDefs[tier];
    const a = sample(city.pop, rng());
    const b = sample(city.jobs, rng());
    const km = (cellDist(a, b, city.w) * city.cellM) / 1000;
    if (km < t.minKm || km > t.maxKm) return null;
    const path = route(city, a, b);
    return path && makeLine(city, p, tier, path, have, 'line', false);
  },
  // Home A, then job V, then home B. The turn at V, from A to B, is at most p.turn.
  via: (city, p, rng, tier, have) => {
    const a = sample(city.pop, rng());
    const v = sample(city.jobs, rng());
    const b = sample(city.pop, rng());
    if (turnAt(city.w, a, v, b) > p.turn) return null;
    return routed(city, p, tier, [a, v, b], have, 'via');
  },
  // Part of a circle around the jobs centre, through a home-weighted cell, radius 3 km or more.
  // It spans 90 to 360 degrees. A via point every 30 degrees moves to the cell with most homes near it.
  // 360 degrees makes a loop.
  arc: (city, p, rng, tier, have) => {
    const { w } = city;
    const [cx, cy] = centre(city);
    const h = sample(city.pop, rng());
    const [hx, hy] = [h % w, Math.floor(h / w)];
    const r = Math.max(Math.hypot(hx - cx, hy - cy), 3000 / city.cellM);
    const a0 = Math.atan2(hy - cy, hx - cx);
    const steps = 3 + Math.floor(rng() * 10);
    const loop = steps === 12;
    const ways: number[] = [];
    for (let k = 0; k <= (loop ? 11 : steps); k++) {
      const a = a0 + (k * Math.PI) / 6;
      const c = homeNear(city, cx + r * Math.cos(a), cy + r * Math.sin(a));
      if (c < 0) return null;
      if (c !== ways[ways.length - 1]) ways.push(c);
    }
    if (loop && ways[ways.length - 1] !== ways[0]) ways.push(ways[0]);
    return routed(city, p, tier, ways, have, 'arc', loop);
  },
};

// A shape name, picked by weight. One shape uses no random number.
function pick(shapes: [string, number][], rng: Rng) {
  if (shapes.length === 1) return shapes[0][0];
  let r = rng() * shapes.reduce((s, [, x]) => s + x, 0);
  for (const [name, x] of shapes) {
    r -= x;
    if (r < 0) return name;
  }
  return shapes[shapes.length - 1][0];
}

// The network with one more random line of a random tier and shape, and with snap > 0
// a snapped variant too. The line fits in the budget left. The new line is the last line.
// Empty if 20 tries make no line. options() uses c.rng and never c.J.
function options(c: Ctx, net: Net, left: number): Net[] {
  const { city, p, rng } = c;
  const have = new Set(net.lines.flatMap((l) => l.stops));
  for (let tries = 0; tries < 20; tries++) {
    const tier = p.tiers[Math.floor(rng() * p.tiers.length)];
    const plain = SHAPES[pick(p.shapes, rng)](city, p, rng, tier, have);
    if (!plain) continue;
    const ns = [plain, p.snap > 0 ? snapped(city, p, plain, have) : null]
      .filter((l): l is Line => !!l && l.cost <= left && l.stops.length > 1)
      .map((l) => add(net, l));
    if (ns.length) return ns;
  }
  return [];
}

// Of the options, the one with more gain per cost. Null if there is no option.
function choose(c: Ctx, net: Net, ns: Net[]): Net | null {
  if (ns.length < 2) return ns[0] ?? null;
  const gain = (n: Net) => (c.J(n) - c.J(net)) / last(n).cost;
  return gain(ns[1]) > gain(ns[0]) ? ns[1] : ns[0];
}

const candidate = (c: Ctx, net: Net, left: number) =>
  choose(c, net, options(c, net, left));

const flip = (l: Line): Line => ({
  ...l,
  path: [...l.path].reverse(),
  stops: [...l.stops].reverse(),
  segs: [...l.segs].reverse(),
});

// The network with two lines merged into one, or null if no two lines can merge.
// Two lines can merge if they have the same tier and an end of one is an end of the other.
// The turn at that station must be at most p.turn. The merged line stops there once.
// The later line paid the interchange price for that station, so the merged cost is less by that price.
// A merge never lowers J in this model. A through trip skips one alight and one board,
// and no other ride or walk changes. So anneal accepts nearly every merge.
function merged(c: Ctx, net: Net): Net | null {
  const { city, p, rng } = c;
  const ok: [Line, Line, number, number][] = [];
  const both = net.lines.map((l) => [l, flip(l)]);
  for (let i = 0; i < net.lines.length; i++)
    for (let j = i + 1; j < net.lines.length; j++) {
      const [x, y] = [net.lines[i], net.lines[j]];
      if (x.tier !== y.tier || x.loop || y.loop) continue;
      // a: line i with the shared end last. b: line j with the shared end first.
      for (const a of both[i])
        for (const b of both[j]) {
          const [sa, sb] = [a.stops, b.stops];
          if (sa[sa.length - 1] !== sb[0] || sa.length < 2 || sb.length < 2)
            continue;
          if (turnAt(city.w, sa[sa.length - 2], sb[0], sb[1]) <= p.turn)
            ok.push([a, b, i, j]);
        }
    }
  if (!ok.length) return null;
  const [a, b, i, j] = ok[Math.floor(rng() * ok.length)];
  const t = p.tierDefs[a.tier];
  const line: Line = {
    tier: a.tier,
    shape: 'join',
    loop: false,
    path: [...a.path, ...b.path.slice(1)],
    stops: [...a.stops, ...b.stops.slice(1)],
    segs: [...a.segs, ...b.segs],
    cost: a.cost + b.cost - t.station * p.interchange,
  };
  return add({ lines: net.lines.filter((_, k) => k !== i && k !== j) }, line);
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
    const left = c.p.budget - spent(net);
    const opts = Array.from({ length: c.p.candidates }, () =>
      options(c, net, left),
    );
    const then = () => {
      const j0 = c.J(net);
      let best = net;
      let gain = 0;
      for (const o of opts) {
        const n2 = choose(c, net, o);
        if (!n2) continue;
        const g = (c.J(n2) - j0) / last(n2).cost;
        if (g > gain) [best, gain] = [n2, g];
      }
      return best;
    };
    return { score: opts.flat(), then };
  },
  // Merge two lines (share p.join of moves), or add, remove or replace one line.
  // Sometimes keep a worse network, less often as the run continues.
  anneal: (net, c) => {
    const r = c.rng();
    const k = Math.floor(c.rng() * net.lines.length);
    const m = (r - c.p.join) / (1 - c.p.join);
    let n2: Net = net;
    if (r < c.p.join) n2 = merged(c, net) ?? net;
    else if (m < 0.4 || !net.lines.length)
      n2 = candidate(c, net, c.p.budget - spent(net)) ?? net;
    else if (m < 0.7) n2 = without(net, k);
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
// It yields a Snap after each step, and the networks of each Batch before its then().
// The caller can send back the score of each network with next(). If it sends nothing, run() scores them.
export function* run(
  city: City,
  p: Params,
): Generator<Snap | Net[], void, number[] | undefined> {
  const memo = new WeakMap<Net, number>();
  const S = samples(city, p);
  const J = (n: Net) => {
    const v = memo.get(n) ?? evaluate(city, n, p, S).J;
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
      const r = ALGOS[algo](net, { city, p, rng, frac: k / count, J });
      if ('score' in r) {
        const js = yield r.score;
        for (const [i, j] of js?.entries() ?? []) memo.set(r.score[i], j);
        net = r.then();
      } else net = r;
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
