/* TEMPORARY: the Venom effect, tuned live from the dev-only panel in
   app/eat-panel.tsx. When the values are settled, they become constants in
   shader-ripple.tsx, and this file and the panel go.

   Once the thrown core has landed, a few tendrils reach out of it for a
   cursor that comes near. Each one moves on springs, and noise swings and
   stretches it. A cursor that comes closer still is eaten: it is hidden
   until it moves away again. */
type EatSettings = {
  reach: number;
  eatRadius: number;
  release: number;
  spring: number;
  damping: number;
  flail: number;
  stretch: number;
  flailPace: number;
  twitch: number;
  tendrils: number;
  share: number;
  spread: number;
  strand: number;
  wiggle: number;
  gulp: number;
};

type EatDef = {
  key: keyof EatSettings;
  label: string;
  min: number;
  max: number;
  step: number;
  hint: string;
};

const EAT_DEFAULTS: EatSettings = {
  reach: 120,
  eatRadius: 14,
  release: 28,
  spring: 3,
  damping: 0.3,
  flail: 30,
  stretch: 0.25,
  flailPace: 1.5,
  twitch: 0.6,
  tendrils: 3,
  share: 0.15,
  spread: 0.3,
  strand: 3,
  wiggle: 4,
  gulp: 1,
};

const EAT_DEFS: EatDef[] = [
  {
    key: 'reach',
    label: 'reach',
    min: 20,
    max: 400,
    step: 5,
    hint: 'The tendrils strike at a cursor inside this distance from the core, in CSS pixels. A tendril is at most 80% of it long.',
  },
  {
    key: 'eatRadius',
    label: 'eat radius',
    min: 2,
    max: 60,
    step: 1,
    hint: 'The core eats a cursor inside this distance, in CSS pixels. The theme toggle starts 32 px from the core.',
  },
  {
    key: 'release',
    label: 'release',
    min: 4,
    max: 120,
    step: 1,
    hint: 'An eaten cursor comes back out past this distance, in CSS pixels. Keep it under 32, or the cursor stays hidden over the theme toggle.',
  },
  {
    key: 'spring',
    label: 'spring',
    min: 0.5,
    max: 10,
    step: 0.1,
    hint: 'How fast a tendril swings toward where it reaches, in swings a second. Each tendril is a little faster or slower than this.',
  },
  {
    key: 'damping',
    label: 'damping',
    min: 0.05,
    max: 1,
    step: 0.01,
    hint: 'How fast a bounce dies. Lower is springier. At 1 a tendril does not overshoot. A tendril that lets go always pulls back with no bounce.',
  },
  {
    key: 'flail',
    label: 'flail angle',
    min: 0,
    max: 90,
    step: 1,
    hint: 'How far noise swings a tendril off the line to the cursor, in degrees.',
  },
  {
    key: 'stretch',
    label: 'flail length',
    min: 0,
    max: 1,
    step: 0.01,
    hint: 'How much noise makes a tendril longer or shorter, against its length.',
  },
  {
    key: 'flailPace',
    label: 'flail pace',
    min: 0.1,
    max: 6,
    step: 0.05,
    hint: 'How fast the flailing changes, in rough changes a second.',
  },
  {
    key: 'twitch',
    label: 'twitches',
    min: 0,
    max: 5,
    step: 0.05,
    hint: 'How often a tendril twitches while it reaches, in twitches a second. A twitch kicks its tip off course.',
  },
  {
    key: 'tendrils',
    label: 'tendrils',
    min: 1,
    // TENDRILS_MAX in shader-ripple.tsx, and the size of u_tendril.
    max: 8,
    step: 1,
    hint: 'How many tendrils reach for the cursor.',
  },
  {
    key: 'share',
    label: 'dots in tendrils',
    min: 0.02,
    max: 0.6,
    step: 0.01,
    hint: 'The share of the core dots that leave it to make the tendrils.',
  },
  {
    key: 'spread',
    label: 'spread',
    min: 0,
    max: 1,
    step: 0.01,
    hint: 'How far the tendrils fan out on the way, against their length. 0 makes one straight strand.',
  },
  {
    key: 'strand',
    label: 'thickness',
    min: 0,
    max: 12,
    step: 0.5,
    hint: 'How wide a tendril is at the core, in CSS pixels. It thins to a point at the tip.',
  },
  {
    key: 'wiggle',
    label: 'writhe',
    min: 0,
    max: 20,
    step: 0.5,
    hint: 'How far a tendril writhes from side to side, in CSS pixels.',
  },
  {
    key: 'gulp',
    label: 'gulp',
    min: 0,
    max: 4,
    step: 0.05,
    hint: 'How much the core swells for a moment when it eats the cursor. 1 doubles its size.',
  },
];

const EAT_PREFIX = 'eat-v1:';

const serialiseEat = (eat: EatSettings) => EAT_PREFIX + JSON.stringify(eat);

/* Read a string from serialiseEat(). Unknown keys are dropped and numbers
   are clamped to their slider range. Returns null when the string is not
   one of ours. */
const deserialiseEat = (text: string): EatSettings | null => {
  const trimmed = text.trim();
  if (!trimmed.startsWith(EAT_PREFIX)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed.slice(EAT_PREFIX.length));
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const input = raw as Record<string, unknown>;

  const eat: EatSettings = { ...EAT_DEFAULTS };
  for (const def of EAT_DEFS) {
    const v = input[def.key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      eat[def.key] = Math.min(def.max, Math.max(def.min, v));
    }
  }
  return eat;
};

export type { EatDef, EatSettings };
export { deserialiseEat, EAT_DEFAULTS, EAT_DEFS, serialiseEat };
