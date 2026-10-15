/* Every knob the ripple playground exposes. Numeric params map one to one
   onto a `u_<key>` uniform unless `uniform` says otherwise; the rest are
   read on the CPU side. */

/* Characters the glyph background cycles through. A roused cell steps
   through its set, so order matters a little: neighbours look related. */
const GLYPH_SETS = {
  ascii: '.:-=+*#%@abcdefghijklmnopqrstuvwxyz0123456789',
  code: '{}[]()<>/\\|;:=+-*&%$#!?_~^',
  dots: '\u00b7\u2219\u2022\u25e6\u25cb\u25cf',
  blocks:
    '\u2591\u2592\u2593\u2588\u2596\u2597\u2598\u259d\u259a\u259e\u2599\u259b\u259c\u259f',
  binary: '01',
  // Not a set of its own: the cells read the `message` param as text.
  message: '',
  katakana:
    '\uff71\uff72\uff73\uff74\uff75\uff76\uff77\uff78\uff79\uff7a\uff7b\uff7c\uff7d\uff7e\uff7f\uff80\uff81\uff82\uff83\uff84\uff85\uff86\uff87\uff88\uff89\uff8a\uff8b\uff8c\uff8d\uff8e\uff8f\uff90\uff91\uff92\uff93\uff94\uff95\uff96\uff97\uff98\uff99\uff9a\uff9b\uff9c\uff9d',
} as const;

type GlyphSet = keyof typeof GLYPH_SETS;

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
  rest: number;
  banding: number;
  afterglow: number;
  nebula: number;
  cloudLevel: number;
  cloudSoft: number;
  cloudGain: number;
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
  // The glyph background
  grid: boolean;
  glyphs: GlyphSet;
  cellSize: number;
  fill: number;
  gridAlpha: number;
  gridIdle: number;
  flicker: number;
  spin: number;
  calm: number;
  message: string;
  rowShift: number;
  textWidth: number;
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
const MAX_MESSAGE = 64; // characters in the glyph background's message

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
  rest: 0.7,
  banding: 0.75,
  afterglow: 0.6,
  nebula: 0.9,
  cloudLevel: 0.2,
  cloudSoft: 0.15,
  cloudGain: 0.8,
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
  grid: false,
  glyphs: 'ascii',
  cellSize: 14,
  fill: 0.85,
  gridAlpha: 0.9,
  gridIdle: 0.12,
  flicker: 0.4,
  spin: 6,
  calm: 0.6,
  message: 'hire me ',
  rowShift: 3,
  textWidth: 0.6,
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
        key: 'rest',
        label: 'resting ink',
        min: 0.1,
        max: 1,
        step: 0.01,
        hint: 'How bright the plain dots are. Below 1 leaves headroom, so a lit dot rises above the rest and reads as glow.',
      },
      {
        key: 'banding',
        label: 'banding',
        min: 0,
        max: 1,
        step: 0.01,
        hint: '0: the front lights evenly. 1: it lights in crest and trough rings, spaced by wavelength.',
      },
      {
        key: 'afterglow',
        label: 'haze',
        min: 0,
        max: 3,
        step: 0.05,
        hint: 'A soft accent haze that gathers just behind the front and lingers.',
      },
      {
        key: 'nebula',
        label: 'nebula',
        min: 0,
        max: 1,
        step: 0.01,
        hint: '0: the front shows everywhere. 1: it shows only where cloud plus ripple clears the cloud level, so it lights in clumps.',
      },
      {
        key: 'cloudLevel',
        label: 'cloud level',
        min: -0.8,
        max: 1.2,
        step: 0.01,
        hint: 'What cloud plus ripple must reach to show. Higher leaves fewer, smaller patches.',
      },
      {
        key: 'cloudSoft',
        label: 'patch edge',
        min: 0.01,
        max: 0.6,
        step: 0.01,
        hint: 'How soft the edge of a lit patch is.',
      },
      {
        key: 'cloudGain',
        label: 'ripple lift',
        min: 0,
        max: 3,
        step: 0.05,
        hint: 'How much the ripple adds to the cloud. Higher lets strong crests break through thin cloud.',
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
    title: 'Glyph background',
    params: [
      {
        key: 'cellSize',
        label: 'cell size',
        min: 6,
        max: 40,
        step: 1,
        hint: 'The size of one glyph cell, in CSS pixels.',
      },
      {
        key: 'fill',
        label: 'fill',
        min: 0.05,
        max: 1,
        step: 0.01,
        hint: 'The share of cells that hold a glyph.',
      },
      {
        key: 'gridAlpha',
        label: 'strength',
        min: 0,
        max: 1,
        step: 0.01,
        hint: 'How strongly a lit glyph shows.',
      },
      {
        key: 'gridIdle',
        label: 'idle drift',
        min: 0,
        max: 1,
        step: 0.01,
        hint: 'How much of the drifting cloud shows as glyphs with no ripple at all.',
      },
      {
        key: 'flicker',
        label: 'flicker',
        min: 0,
        max: 4,
        step: 0.05,
        hint: 'How many times a second a resting glyph changes, on average.',
      },
      {
        key: 'spin',
        label: 'spin',
        min: 0,
        max: 24,
        step: 1,
        hint: 'How many glyphs a cell runs through as a front passes, and back as it settles.',
      },
      {
        key: 'calm',
        label: 'calm behind portrait',
        min: 0,
        max: 1,
        step: 0.01,
        hint: 'How much the grid thins out behind the portrait.',
      },
      {
        key: 'rowShift',
        label: 'row shift',
        min: 0,
        max: 16,
        step: 1,
        hint: 'With the message set: how many characters each row starts on from the row above.',
      },
      {
        key: 'textWidth',
        label: 'letter width',
        min: 0.4,
        max: 1,
        step: 0.01,
        hint: "With the message set: a cell's width against its height. Lower sets the letters closer, like a terminal.",
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

/* The first version: a regular 5-lobed ring in one even colour. The
   uniform-colour presets build on it. */
const STARFISH: Partial<RippleParams> = {
  wobble: 0.35,
  warp: 0,
  rest: 1,
  banding: 0,
  afterglow: 0,
  nebula: 0,
  trail: 0.7,
  heartChance: 0,
  grid: false,
};

/* The home page's look: a big, slow, even-coloured starfish. */
const TSUNAMI: Partial<RippleParams> = {
  ...STARFISH,
  reach: 30,
  slow: 2.2,
  fade: 3,
  frontWidth: 3,
  push: 0.25,
  crest: 0.8,
  trail: 1.2,
  trailLen: 10,
};

const PRESETS: Record<string, Partial<RippleParams>> = {
  nebula: {},
  starfish: STARFISH,
  gentle: {
    reach: 10,
    push: 0.05,
    fade: 1.1,
    crest: 0.3,
    trail: 0.4,
    swell: 0.2,
  },
  tsunami: TSUNAMI,
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
  'glyph field': { grid: true },
  'tsunami field': { ...TSUNAMI, grid: true },
  'hire me': {
    grid: true,
    glyphs: 'message',
    message: 'hire me ',
    fill: 1,
    flicker: 0,
    gridIdle: 0.3,
  },
  'slow-mo': { timeScale: 0.2 },
  'hard edge': { tintLo: 0.2, tintHi: 0.22, trail: 0, glowFade: 0.6 },
};

/* What the home page runs: the tsunami preset. */
const HOME_PARAMS: RippleParams = { ...DEFAULTS, ...PRESETS.tsunami };

/* Settings that rebuild the sim or only affect the playground. */
/* `size` is the canvas edge in CSS pixels, or 0 to fill the stage. */
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
  if (typeof input.grid === 'boolean') params.grid = input.grid;
  if (typeof input.glyphs === 'string' && input.glyphs in GLYPH_SETS) {
    params.glyphs = input.glyphs as GlyphSet;
  }
  if (
    typeof input.message === 'string' &&
    input.message.length > 0 &&
    input.message.length <= MAX_MESSAGE
  ) {
    params.message = input.message;
  }

  const stage: StageSettings = { ...STAGE_DEFAULTS };
  if (SIM_SIZES.includes(input.simSize as number)) {
    stage.simSize = input.simSize as number;
  }
  if (input.size === 0) {
    stage.size = 0;
  } else if (typeof input.size === 'number' && Number.isFinite(input.size)) {
    stage.size = Math.min(1000, Math.max(200, Math.round(input.size)));
  }

  return { params, stage };
};

export type { GlyphSet, ParamDef, ParamGroup, RippleParams, StageSettings };
export {
  DEFAULTS,
  GLYPH_SETS,
  HOME_PARAMS,
  deserialise,
  GROUPS,
  MAX_MESSAGE,
  MAX_TAPS,
  PRESETS,
  SIM_SIZES,
  STAGE_DEFAULTS,
  serialise,
};
