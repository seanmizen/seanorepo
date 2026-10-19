/* TEMPORARY: the core's flight, tuned live from the dev-only panel in
   app/flight-panel.tsx. When the values are settled, they become constants
   in shader-ripple.tsx, and this file and the panel go.

   On /projects the face falls into a core, and then the core is thrown: it
   rises by `arc`, falls to `margin` above the bottom of the view, and
   shrinks as it goes, as if it flew away from the viewer. */
type FlightSettings = {
  delay: number;
  time: number;
  arc: number;
  endX: number;
  endSize: number;
  endOpacity: number;
  margin: number;
};

type FlightDef = {
  key: keyof FlightSettings;
  label: string;
  min: number;
  max: number;
  step: number;
  hint: string;
};

const FLIGHT_DEFAULTS: FlightSettings = {
  delay: 0.3,
  time: 1.4,
  arc: 140,
  endX: 0,
  endSize: 0.4,
  endOpacity: 1,
  margin: 27,
};

const FLIGHT_DEFS: FlightDef[] = [
  {
    key: 'delay',
    label: 'delay',
    min: 0,
    max: 3,
    step: 0.05,
    hint: 'Seconds from the core forming to the throw.',
  },
  {
    key: 'time',
    label: 'flight time',
    min: 0.2,
    max: 4,
    step: 0.05,
    hint: 'Seconds in the air.',
  },
  {
    key: 'arc',
    label: 'arc height',
    min: 0,
    max: 400,
    step: 5,
    hint: 'How far the core rises before it falls, in CSS pixels. 0 drops it straight down the curve.',
  },
  {
    key: 'endX',
    label: 'land x',
    min: -600,
    max: 600,
    step: 5,
    hint: 'Where the core lands, left or right of the middle, in CSS pixels.',
  },
  {
    key: 'endSize',
    label: 'land size',
    min: 0.05,
    max: 1,
    step: 0.01,
    hint: 'The core size when it lands, against its size at the start. Smaller looks further away.',
  },
  {
    key: 'endOpacity',
    label: 'land opacity',
    min: 0,
    max: 1,
    step: 0.01,
    hint: 'How strongly the core shows when it lands. 0 makes it vanish.',
  },
  {
    key: 'margin',
    label: 'bottom margin',
    min: 0,
    max: 120,
    step: 1,
    hint: 'The gap below the landed core, in CSS pixels. The theme toggle box is 16 px up, and its icon is 27 px up.',
  },
];

const FLIGHT_PREFIX = 'flight-v1:';

const serialiseFlight = (flight: FlightSettings) =>
  FLIGHT_PREFIX + JSON.stringify(flight);

/* Read a string from serialiseFlight(). Unknown keys are dropped and
   numbers are clamped to their slider range. Returns null when the string
   is not one of ours. */
const deserialiseFlight = (text: string): FlightSettings | null => {
  const trimmed = text.trim();
  if (!trimmed.startsWith(FLIGHT_PREFIX)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed.slice(FLIGHT_PREFIX.length));
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const input = raw as Record<string, unknown>;

  const flight: FlightSettings = { ...FLIGHT_DEFAULTS };
  for (const def of FLIGHT_DEFS) {
    const v = input[def.key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      flight[def.key] = Math.min(def.max, Math.max(def.min, v));
    }
  }
  return flight;
};

export type { FlightDef, FlightSettings };
export { deserialiseFlight, FLIGHT_DEFAULTS, FLIGHT_DEFS, serialiseFlight };
