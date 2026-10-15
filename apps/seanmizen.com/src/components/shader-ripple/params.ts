/* Every knob the ripple playground exposes. Numeric params map one to one
   onto a `u_<key>` uniform unless `uniform` says otherwise; the rest are
   read on the CPU side. */

type RippleParams = {
  // The front
  reach: number;
  slow: number;
  fade: number;
  frontWidth: number;
  widthGrow: number;
  wave: number;
  crest: number;
  wobble: number;
  lobes: number;
  warp: number;
  warpScale: number;
  warpSpeed: number;
  push: number;
  // The light
  nebula: number;
  nebulaScale: number;
  nebulaSpeed: number;
  glowFade: number;
  trail: number;
  trailLen: number;
  tintLo: number;
  tintHi: number;
  swell: number;
  // Springing back home
  springBack: boolean;
  spring: number;
  springDamp: number;
  // The particles
  dt: number;
  repel: number;
  chargeBase: number;
  chargeGain: number;
  particleSize: number;
  // Clicks and time
  strength: number;
  heartChance: number;
  maxTaps: number;
  timeScale: number;
  // Colours
  lightInk: string;
  lightAccent: string;
  darkInk: string;
  darkAccent: string;
};

type NumericKey = {
  [K in keyof RippleParams]: RippleParams[K] extends number ? K : never;
}[keyof RippleParams];

type ParamDef = {
  key: NumericKey;
  label: string;
  min: number;
  max: number;
  step: number;
  hint: string;
};

type ParamGroup = { title: string; params: ParamDef[] };

const MAX_TAPS = 16; // must match MAX_TAPS in ripple.glsl

const DEFAULTS: RippleParams = {
  reach: 16,
  slow: 1.3,
  fade: 1.5,
  frontWidth: 1.6,
  widthGrow: 1,
  wave: 3,
  crest: 0.6,
  wobble: 0,
  lobes: 5,
  warp: 0.8,
  warpScale: 2.5,
  warpSpeed: 0.12,
  push: 0.1,
  nebula: 0.9,
  nebulaScale: 3,
  nebulaSpeed: 0.1,
  glowFade: 1,
  trail: 0.3,
  trailLen: 5,
  tintLo: 0.04,
  tintHi: 0.3,
  swell: 0.4,
  springBack: true,
  spring: 0.03,
  springDamp: 0.12,
  dt: 0.78,
  repel: 0.03,
  chargeBase: 0.045,
  chargeGain: 0.03,
  particleSize: 40,
  strength: 1,
  heartChance: 0.15,
  maxTaps: 8,
  timeScale: 1,
  lightInk: '#000000',
  lightAccent: '#e0262b',
  darkInk: '#dddddd',
  darkAccent: '#3d8bff',
};

const GROUPS: ParamGroup[] = [
  {
    title: 'Front',
    params: [
      {
        key: 'reach',
        label: 'reach',
        min: 2,
        max: 40,
        step: 0.5,
        hint: 'How far a front travels before it stalls (world units).',
      },
      {
        key: 'slow',
        label: 'ease-out',
        min: 0.1,
        max: 5,
        step: 0.05,
        hint: 'Seconds for the front to lose most of its speed.',
      },
      {
        key: 'fade',
        label: 'fade',
        min: 0.1,
        max: 6,
        step: 0.05,
        hint: 'Seconds for the push to die away.',
      },
      {
        key: 'frontWidth',
        label: 'width',
        min: 0.2,
        max: 6,
        step: 0.1,
        hint: "The front's thickness at the start.",
      },
      {
        key: 'widthGrow',
        label: 'widen',
        min: 0,
        max: 5,
        step: 0.1,
        hint: 'How much thicker the front gets each second.',
      },
      {
        key: 'wave',
        label: 'wavelength',
        min: 0.5,
        max: 12,
        step: 0.1,
        hint: 'Distance from crest to crest behind the front.',
      },
      {
        key: 'crest',
        label: 'trough',
        min: 0,
        max: 1,
        step: 0.01,
        hint: '0: push only outward. 1: the trough pulls back as hard as the crest pushes.',
      },
      {
        key: 'wobble',
        label: 'lobe depth',
        min: 0,
        max: 3,
        step: 0.05,
        hint: 'How far regular lobes push the outline out. The starfish look.',
      },
      {
        key: 'lobes',
        label: 'lobes',
        min: 0,
        max: 16,
        step: 1,
        hint: 'How many regular lobes the outline has.',
      },
      {
        key: 'warp',
        label: 'warp',
        min: 0,
        max: 4,
        step: 0.05,
        hint: 'How far noise bends the outline off a circle.',
      },
      {
        key: 'warpScale',
        label: 'warp size',
        min: 0.3,
        max: 12,
        step: 0.1,
        hint: 'The size of a bend. Small values give a ragged edge, large values a lopsided ring.',
      },
      {
        key: 'warpSpeed',
        label: 'warp drift',
        min: 0,
        max: 1,
        step: 0.01,
        hint: 'How fast the bends change as the ring grows.',
      },
      {
        key: 'push',
        label: 'push',
        min: 0,
        max: 0.6,
        step: 0.005,
        hint: 'How hard a front shoves the particles.',
      },
    ],
  },
  {
    title: 'Light',
    params: [
      {
        key: 'nebula',
        label: 'nebula',
        min: 0,
        max: 1,
        step: 0.01,
        hint: '0: the front glows evenly. 1: it lights only where a drifting cloud is thick, so the ring breaks into patches.',
      },
      {
        key: 'nebulaScale',
        label: 'cloud size',
        min: 0.5,
        max: 12,
        step: 0.1,
        hint: 'The size of a cloud patch.',
      },
      {
        key: 'nebulaSpeed',
        label: 'cloud drift',
        min: 0,
        max: 1,
        step: 0.01,
        hint: 'How fast the clouds change.',
      },
      {
        key: 'glowFade',
        label: 'glow fade',
        min: 0.1,
        max: 5,
        step: 0.05,
        hint: "Seconds for the front's tint to die away.",
      },
      {
        key: 'trail',
        label: 'afterlight',
        min: 0,
        max: 3,
        step: 0.05,
        hint: 'How strong the glow left inside the ring is.',
      },
      {
        key: 'trailLen',
        label: 'afterlight length',
        min: 0.5,
        max: 20,
        step: 0.5,
        hint: 'How far behind the front the afterlight reaches.',
      },
      {
        key: 'tintLo',
        label: 'tint starts',
        min: 0,
        max: 1,
        step: 0.01,
        hint: 'Glow below this shows no tint.',
      },
      {
        key: 'tintHi',
        label: 'tint whole',
        min: 0.01,
        max: 2,
        step: 0.01,
        hint: 'Glow above this is fully tinted. Close to "tint starts" gives a hard edge.',
      },
      {
        key: 'swell',
        label: 'swell',
        min: 0,
        max: 2,
        step: 0.05,
        hint: 'How much a particle grows while a front passes.',
      },
    ],
  },
  {
    title: 'Spring back',
    params: [
      {
        key: 'spring',
        label: 'stiffness',
        min: 0.002,
        max: 0.2,
        step: 0.001,
        hint: 'How hard a pushed particle is pulled back to where it would have been. Only with "spring back home" on.',
      },
      {
        key: 'springDamp',
        label: 'damping',
        min: 0.01,
        max: 0.6,
        step: 0.01,
        hint: 'How much of its speed a returning particle loses each frame. Low values overshoot and wobble.',
      },
    ],
  },
  {
    title: 'Particles',
    params: [
      {
        key: 'dt',
        label: 'time step',
        min: 0.1,
        max: 1.5,
        step: 0.01,
        hint: 'Sim step. Higher moves faster but can jitter.',
      },
      {
        key: 'repel',
        label: 'repulsion',
        min: 0,
        max: 0.15,
        step: 0.001,
        hint: 'How hard the particles push each other apart. This is what pulls the portrait back.',
      },
      {
        key: 'chargeBase',
        label: 'reach on light',
        min: 0.005,
        max: 0.2,
        step: 0.001,
        hint: "A particle's reach over the photo's light areas.",
      },
      {
        key: 'chargeGain',
        label: 'reach on dark',
        min: 0,
        max: 0.2,
        step: 0.001,
        hint: 'Extra reach over dark areas. Sets the contrast of the portrait.',
      },
      {
        key: 'particleSize',
        label: 'dot size',
        min: 5,
        max: 120,
        step: 1,
        hint: 'Base point size.',
      },
    ],
  },
  {
    title: 'Clicks and time',
    params: [
      {
        key: 'strength',
        label: 'click strength',
        min: 0.1,
        max: 3,
        step: 0.05,
        hint: 'Strength of each new click.',
      },
      {
        key: 'heartChance',
        label: 'heart chance',
        min: 0,
        max: 1,
        step: 0.01,
        hint: 'The chance that a click runs out as a heart instead of a ring.',
      },
      {
        key: 'maxTaps',
        label: 'ripples at once',
        min: 1,
        max: MAX_TAPS,
        step: 1,
        hint: 'Ring buffer size. A new click takes the oldest slot.',
      },
      {
        key: 'timeScale',
        label: 'time scale',
        min: 0.05,
        max: 3,
        step: 0.05,
        hint: 'Slow the ripples down to study them. The sim keeps its own step.',
      },
    ],
  },
];

const PRESETS: Record<string, Partial<RippleParams>> = {
  nebula: {},
  // The first version: a regular 5-lobed ring that glows evenly.
  starfish: {
    wobble: 0.35,
    warp: 0,
    nebula: 0,
    trail: 0.7,
    heartChance: 0,
  },
  gentle: {
    reach: 10,
    push: 0.05,
    fade: 1.1,
    crest: 0.3,
    trail: 0.4,
    swell: 0.2,
  },
  tsunami: {
    reach: 30,
    slow: 2.2,
    fade: 3,
    frontWidth: 3,
    push: 0.25,
    crest: 0.8,
    trail: 1.2,
    trailLen: 10,
  },
  jelly: {
    push: 0.18,
    crest: 1,
    wave: 1.6,
    warp: 1.8,
    warpScale: 1.5,
    spring: 0.05,
    springDamp: 0.04,
  },
  physical: { springBack: false },
  'slow-mo': { timeScale: 0.2 },
  'hard edge': { tintLo: 0.2, tintHi: 0.22, trail: 0, glowFade: 0.6 },
};

/* Settings that rebuild the sim or only affect the playground. */
type StageSettings = { simSize: number; size: number };

const STAGE_DEFAULTS: StageSettings = { simSize: 64, size: 500 };
const SIM_SIZES = [32, 48, 64, 80, 96];

/* Everything a setup needs, as one string: a version tag, then compact
   JSON. Bump the tag when a key changes meaning, so an old string is not
   read with the new meaning. */
const PREFIX = 'ripple-v1:';

const serialise = (params: RippleParams, stage: StageSettings) =>
  PREFIX + JSON.stringify({ ...params, ...stage });

const HEX = /^#[0-9a-f]{6}$/i;
const NUMERIC_DEFS = new Map(
  GROUPS.flatMap((g) => g.params).map((d) => [d.key, d] as const),
);

/* Read a string from serialise(). Keys it does not know are dropped and
   numbers are clamped to their slider range, so a hand-edited string
   cannot break the shader. Returns null when the string is not one of
   ours. */
const deserialise = (
  text: string,
): { params: RippleParams; stage: StageSettings } | null => {
  const trimmed = text.trim();
  if (!trimmed.startsWith(PREFIX)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed.slice(PREFIX.length));
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const input = raw as Record<string, unknown>;

  const params: RippleParams = { ...DEFAULTS };
  for (const [key, def] of NUMERIC_DEFS) {
    const v = input[key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      params[key] = Math.min(def.max, Math.max(def.min, v));
    }
  }
  for (const key of [
    'lightInk',
    'lightAccent',
    'darkInk',
    'darkAccent',
  ] as const) {
    const v = input[key];
    if (typeof v === 'string' && HEX.test(v)) params[key] = v;
  }

  if (typeof input.springBack === 'boolean') {
    params.springBack = input.springBack;
  }

  const stage: StageSettings = { ...STAGE_DEFAULTS };
  if (SIM_SIZES.includes(input.simSize as number)) {
    stage.simSize = input.simSize as number;
  }
  if (typeof input.size === 'number' && Number.isFinite(input.size)) {
    stage.size = Math.min(1000, Math.max(200, Math.round(input.size)));
  }

  return { params, stage };
};

export type { ParamDef, ParamGroup, RippleParams, StageSettings };
export {
  DEFAULTS,
  deserialise,
  GROUPS,
  MAX_TAPS,
  PRESETS,
  SIM_SIZES,
  STAGE_DEFAULTS,
  serialise,
};
