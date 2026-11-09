import { ALGOS } from './net.ts';

export type Tier = {
  spacing: number; // m between stops
  speed: number; // km/h top speed
  headway: number; // min between trains
  dwell: number; // s at each stop
  accel: number; // m/s²
  cost: number; // per km of build weight
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
    minKm: 15,
    maxKm: 60,
  },
};

export const DEFAULTS = {
  seed: 1,
  sea: 0.2,
  rivers: 2,
  hills: 0.3,
  warp: 0.3,
  algo: '',
  steps: 30,
  run: 1,
  N: 30,
  budget: 1500,
  candidates: 12,
  tiers: 'tram,tube,rer,express',
};

export type Params = Omit<typeof DEFAULTS, 'tiers'> & {
  tiers: string[];
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
  return { ...(out as typeof DEFAULTS), tiers, chain, tierDefs };
}
