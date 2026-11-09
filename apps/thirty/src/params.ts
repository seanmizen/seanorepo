import { ALGOS, SHAPES } from './net.ts';

export type Tier = {
  spacing: number; // m between stops
  speed: number; // km/h top speed
  headway: number; // min between trains
  dwell: number; // s at each stop
  accel: number; // m/s²
  cost: number; // per km of build weight
  station: number; // per new station
  minKm: number; // shortest line
  maxKm: number; // longest line
};

export const TIER_DEFAULTS: Record<string, Tier> = {
  tram: {
    spacing: 500,
    speed: 50,
    headway: 4,
    dwell: 20,
    accel: 1,
    cost: 1,
    station: 0,
    minKm: 2,
    maxKm: 8,
  },
  tube: {
    spacing: 1000,
    speed: 80,
    headway: 3,
    dwell: 30,
    accel: 1,
    cost: 3,
    station: 0,
    minKm: 4,
    maxKm: 16,
  },
  rer: {
    spacing: 3000,
    speed: 120,
    headway: 5,
    dwell: 40,
    accel: 0.8,
    cost: 3,
    station: 0,
    minKm: 8,
    maxKm: 35,
  },
  express: {
    spacing: 10000,
    speed: 160,
    headway: 8,
    dwell: 60,
    accel: 0.6,
    cost: 4,
    station: 0,
    minKm: 15,
    maxKm: 60,
  },
};

export const DEFAULTS = {
  city: '',
  seed: 1,
  size: 128,
  cell: 350,
  sea: 0.2,
  rivers: 2,
  hills: 0.3,
  warp: 0.3,
  algo: 'greedy',
  steps: 30,
  run: 1,
  N: 30,
  walk: 0, // longest walk leg in minutes. 0: the same as N
  samples: 32, // job samples in J, at most the cells with jobs
  budget: 1500,
  candidates: 12,
  interchange: 0.25, // share of station cost to stop where a station exists
  snap: 0, // radius, as a share of spacing, to move a stop to a station
  tiers: 'tram,tube,rer,express',
  shapes: 'line:1', // line shapes and their weights
  turn: 105, // largest turn in degrees at a via point or a join station
  join: 0, // share of anneal moves that merge two lines
  gpu: 1, // 1: score on the GPU if the browser has WebGPU. 0: on the CPU
};

export type Params = Omit<typeof DEFAULTS, 'tiers' | 'shapes'> & {
  tiers: string[];
  shapes: [string, number][];
  chain: [string, number][];
  tierDefs: Record<string, Tier>;
};

const num = (k: string, v: string) => {
  const x = Number(v);
  if (v === '' || !Number.isFinite(x))
    throw new Error(`Parameter ${k} must be a number.`);
  return x;
};

export const defaultOf = (k: string) => {
  const [t, f] = k.split('.');
  return f
    ? TIER_DEFAULTS[t]?.[f as keyof Tier]
    : DEFAULTS[k as keyof typeof DEFAULTS];
};

export function parse(qs: string): Params {
  const out: Record<string, unknown> = { ...DEFAULTS };
  const tierDefs = structuredClone(TIER_DEFAULTS);
  for (const [k, v] of new URLSearchParams(qs)) {
    const def = defaultOf(k);
    if (def === undefined) throw new Error(`Unknown parameter: ${k}.`);
    const [t, f] = k.split('.');
    if (f) tierDefs[t][f as keyof Tier] = num(k, v);
    else out[k] = typeof def === 'number' ? num(k, v) : v;
  }
  const tiers = String(out.tiers).split(',');
  for (const t of tiers)
    if (!tierDefs[t]) throw new Error(`Unknown tier: ${t}.`);
  const chain = out.algo
    ? String(out.algo)
        .split(',')
        .map((s): [string, number] => {
          const [a, c] = s.split(':');
          if (!ALGOS[a]) throw new Error(`Unknown algorithm: ${a}.`);
          return [a, c ? num('algo', c) : (out.steps as number)];
        })
    : [];
  const shapes = String(out.shapes)
    .split(',')
    .map((s): [string, number] => {
      const [a, w] = s.split(':');
      if (!SHAPES[a]) throw new Error(`Unknown shape: ${a}.`);
      return [a, w ? num('shapes', w) : 1];
    });
  const walk = (out.walk as number) || (out.N as number);
  return { ...(out as typeof DEFAULTS), walk, tiers, shapes, chain, tierDefs };
}
