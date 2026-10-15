import type { RippleParams } from './params';
import { DEFAULTS, MAX_MESSAGE } from './params';

/* The home page's text field: a message that a reveal front writes out
   from the face when "projects" opens, kept clear of the face and of the
   page content. A click's front runs out from the portrait in the home
   page's look and, past `crossfade`, in the nebula look. */
type HireSettings = {
  message: string;
  letterSize: number;
  textStrength: number;
  textDrift: number;
  clearFace: number;
  clearSoft: number;
  crossfade: number;
  revealTime: number;
  revealGlow: number;
};

type HireNumericKey = Exclude<keyof HireSettings, 'message'>;

type HireDef = {
  key: HireNumericKey;
  label: string;
  min: number;
  max: number;
  step: number;
  hint: string;
};

const HIRE_DEFAULTS: HireSettings = {
  message: 'hire me ',
  letterSize: 14,
  textStrength: 0.11,
  textDrift: 1,
  clearFace: 10,
  clearSoft: 2,
  crossfade: 9,
  revealTime: 5,
  revealGlow: 0.3,
};

const HIRE_DEFS: HireDef[] = [
  {
    key: 'letterSize',
    label: 'letter size',
    min: 8,
    max: 28,
    step: 1,
    hint: 'The height of a line of text, in CSS pixels.',
  },
  {
    key: 'textStrength',
    label: 'text strength',
    min: 0.02,
    max: 1,
    step: 0.01,
    hint: 'How strongly the resting text shows. A ripple lifts it to full.',
  },
  {
    key: 'textDrift',
    label: 'breathing',
    min: 0,
    max: 1,
    step: 0.01,
    hint: 'How much a slow drifting cloud makes the resting text come and go.',
  },
  {
    key: 'clearFace',
    label: 'clear around face',
    min: 0,
    max: 30,
    step: 0.5,
    hint: 'The radius kept clear of text around the portrait (world units; the portrait is about 8).',
  },
  {
    key: 'clearSoft',
    label: 'clear softness',
    min: 0.05,
    max: 2,
    step: 0.05,
    hint: 'How gently the text fades in at the edge of the clear areas.',
  },
  {
    key: 'crossfade',
    label: 'nebula from',
    min: 0,
    max: 40,
    step: 0.5,
    hint: 'How far from the face a click front turns from the home page look into the nebula look.',
  },
  {
    key: 'revealTime',
    label: 'reveal time',
    min: 0.3,
    max: 5,
    step: 0.05,
    hint: 'Seconds for the reveal front to write the text out to the edges.',
  },
  {
    key: 'revealGlow',
    label: 'edge glow',
    min: 0,
    max: 1,
    step: 0.01,
    hint: 'How brightly the reveal front glows as it writes the text. It scrambles the letters either way.',
  },
];

/* The look a click front takes on past `crossfade`: the nebula look. */
const OUTER_LOOK: Pick<RippleParams, 'warp' | 'wobble' | 'banding' | 'nebula'> =
  {
    warp: DEFAULTS.warp,
    wobble: 0,
    banding: DEFAULTS.banding,
    nebula: DEFAULTS.nebula,
  };

const HIRE_PREFIX = 'hire-v1:';

const serialiseHire = (hire: HireSettings) =>
  HIRE_PREFIX + JSON.stringify(hire);

/* Read a string from serialiseHire(). Unknown keys are dropped and numbers
   are clamped to their slider range. Returns null when the string is not
   one of ours. */
const deserialiseHire = (text: string): HireSettings | null => {
  const trimmed = text.trim();
  if (!trimmed.startsWith(HIRE_PREFIX)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed.slice(HIRE_PREFIX.length));
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const input = raw as Record<string, unknown>;

  const hire: HireSettings = { ...HIRE_DEFAULTS };
  for (const def of HIRE_DEFS) {
    const v = input[def.key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      hire[def.key] = Math.min(def.max, Math.max(def.min, v));
    }
  }
  if (
    typeof input.message === 'string' &&
    input.message.length > 0 &&
    input.message.length <= MAX_MESSAGE
  ) {
    hire.message = input.message;
  }
  return hire;
};

export type { HireDef, HireSettings };
export { deserialiseHire, HIRE_DEFAULTS, HIRE_DEFS, OUTER_LOOK, serialiseHire };
