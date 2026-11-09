import { createNoise2D } from 'simplex-noise';
import type { Params } from './params.ts';

// The contract between the generator and real data: a square grid in metres.
// water: 0 land, 1 sea, 2 river. pop and jobs each sum to 1.
export type City = {
  w: number;
  cellM: number;
  elev: Float32Array;
  water: Uint8Array;
  pop: Float32Array;
  jobs: Float32Array;
};

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Noise and centres work in metres, so a bigger `size` adds area. 44.8 km is the default map.
export function genCity(p: Params): City {
  const w = p.size;
  const cellM = p.cell;
  const n = w * w;
  const unit = cellM / 44800;
  const area = (w * unit) ** 2;
  const rng = mulberry32(p.seed);
  const noise = createNoise2D(rng);
  const fbm = (x: number, y: number) => {
    let s = 0;
    for (let o = 0, a = 1; o < 5; o++, a /= 2)
      s += a * noise(x * 2 ** o, y * 2 ** o);
    return s / 1.9375;
  };

  // Height: warped fBm plus ridges. Sea level is the quantile that gives `sea`.
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = (i % w) * unit;
    const v = Math.floor(i / w) * unit;
    const x = u + p.warp * 0.4 * fbm(u * 3 + 11, v * 3);
    const y = v + p.warp * 0.4 * fbm(u * 3, v * 3 + 7);
    raw[i] =
      fbm(x * 2.5, y * 2.5) +
      p.hills * (1 - Math.abs(fbm(x * 4 + 3, y * 4 + 3)));
  }
  const level = [...raw].sort((a, b) => a - b)[
    Math.min(n - 1, Math.floor(p.sea * n))
  ];
  const water = new Uint8Array(n);
  const elev = new Float32Array(n);
  let top = 0;
  for (let i = 0; i < n; i++) {
    if (raw[i] < level) water[i] = 1;
    else elev[i] = (raw[i] - level) * (150 + 600 * p.hills);
    top = Math.max(top, elev[i]);
  }

  // Rivers: steepest descent over 4 neighbours, from high land to the sea or a pit.
  for (let r = 0; r < p.rivers; r++) {
    let i = -1;
    for (let t = 0; t < 500 && i < 0; t++) {
      const c = Math.floor(rng() * n);
      if (!water[c] && elev[c] > top * 0.4) i = c;
    }
    while (i >= 0 && water[i] !== 1) {
      water[i] = 2;
      let next = -1;
      for (const j of near4(i, w))
        if (elev[j] < elev[next < 0 ? i : next]) next = j;
      i = next;
    }
  }

  const slope = slopes(elev, w, cellM);

  // Centres: flat land near water, Zipf sizes, at least 15 cells apart.
  const picks: { i: number; s: number }[] = [];
  for (let t = 0; t < 300 * area; t++) {
    const i = Math.floor(rng() * n);
    if (water[i]) continue;
    let wet = false;
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) wet ||= water[i + dy * w + dx] > 0;
    picks.push({
      i,
      s: Math.exp(-20 * slope[i]) * (wet ? 1.5 : 1) * (0.5 + rng()),
    });
  }
  picks.sort((a, b) => b.s - a.s);
  const centres: number[] = [];
  const k = Math.round((3 + Math.floor(rng() * 4)) * area);
  for (const { i } of picks)
    if (
      centres.length < k &&
      centres.every((c) => cellDist(c, i, w) * cellM > 5250)
    )
      centres.push(i);

  const pop = new Float32Array(n);
  const jobs = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (water[i]) continue;
    const tex =
      (0.75 +
        0.25 *
          fbm(((i % w) * cellM) / 3500, (Math.floor(i / w) * cellM) / 3500)) *
      Math.exp(-10 * slope[i]);
    centres.forEach((c, j) => {
      const d = cellDist(c, i, w) * cellM;
      const b = 4000 / Math.sqrt(j + 1);
      pop[i] += (tex * Math.exp(-d / b)) / (j + 1);
      jobs[i] += (tex * Math.exp(-d / (0.35 * b))) / (j + 1);
    });
    jobs[i] += 0.02 * pop[i];
  }
  return { w, cellM, elev, water, pop: norm(pop), jobs: norm(jobs) };
}

// Real data: Float32 [w, cellM, elev, water, pop, jobs], row 0 north. See scripts/import-city.py.
export function fromBytes(buf: ArrayBuffer, name: string): City {
  const f = new Float32Array(buf);
  const w = f[0];
  const n = w * w;
  if (!Number.isInteger(w) || w < 16 || w > 2048 || f.length !== 2 + 4 * n)
    throw new Error(`City ${name} is not a valid city file.`);
  const at = (k: number) => f.slice(2 + k * n, 2 + (k + 1) * n);
  return {
    w,
    cellM: f[1],
    elev: at(0),
    water: Uint8Array.from(at(1)),
    pop: norm(at(2)),
    jobs: norm(at(3)),
  };
}

export const cellDist = (a: number, b: number, w: number) =>
  Math.hypot((a % w) - (b % w), Math.floor(a / w) - Math.floor(b / w));

function near4(i: number, w: number) {
  const x = i % w;
  const out: number[] = [];
  if (x > 0) out.push(i - 1);
  if (x < w - 1) out.push(i + 1);
  if (i >= w) out.push(i - w);
  if (i < w * w - w) out.push(i + w);
  return out;
}

function slopes(elev: Float32Array, w: number, cellM: number) {
  const s = new Float32Array(w * w);
  for (let i = 0; i < w * w; i++) {
    for (const j of near4(i, w))
      s[i] = Math.max(s[i], Math.abs(elev[j] - elev[i]) / cellM);
  }
  return s;
}

function norm(a: Float32Array) {
  const sum = a.reduce((s, x) => s + x, 0) || 1;
  return a.map((x) => x / sum);
}
