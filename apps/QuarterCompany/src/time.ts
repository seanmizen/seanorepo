// Turn labels and the simulated calendar. See REQ-QC-003.
//
// A label is `fy{year}-q{quarter}-d{day}-t{slot}`, with no zero padding:
// `fy1-q1-d1-t1`. Day is the working day inside the quarter. Slot 0 of the
// first day is the genesis turn, where the scenario seeds the world. Code
// sorts turns by `ord`, never by label text.

export interface Calendar {
  dayStart: string; // "09:00"
  dayEnd: string; // "17:00"
  slotMinutes: number;
  daysPerQuarter: number;
  quartersPerYear: number;
}

export const DEFAULT_CALENDAR: Calendar = {
  dayStart: '09:00',
  dayEnd: '17:00',
  slotMinutes: 15,
  daysPerQuarter: 65,
  quartersPerYear: 4,
};

export interface Turn {
  fy: number;
  q: number;
  d: number;
  t: number;
}

const LABEL = /^fy(\d+)-q(\d+)-d(\d+)-t(\d+)$/;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export const turnsPerDay = (cal: Calendar) =>
  Math.floor(
    (toMinutes(cal.dayEnd) - toMinutes(cal.dayStart)) / cal.slotMinutes,
  );

export const GENESIS = 'fy1-q1-d1-t0';

export function parseTurn(label: string): Turn {
  const m = LABEL.exec(label.trim());
  if (!m)
    throw new Error(
      `Turn label "${label}" is not valid. Use the form fy1-q1-d1-t1.`,
    );
  const [fy, q, d, t] = m.slice(1).map(Number);
  return { fy, q, d, t };
}

export const formatTurn = (t: Turn) => `fy${t.fy}-q${t.q}-d${t.d}-t${t.t}`;

export function ordOf(label: string, cal: Calendar): number {
  const t = parseTurn(label);
  if (t.t === 0) {
    if (label !== GENESIS)
      throw new Error(`Slot t0 is valid only for ${GENESIS}.`);
    return 0;
  }
  const tpd = turnsPerDay(cal);
  if (t.fy < 1 || t.q < 1 || t.q > cal.quartersPerYear)
    throw new Error(`Turn "${label}" is outside the calendar.`);
  if (t.d < 1 || t.d > cal.daysPerQuarter || t.t > tpd)
    throw new Error(`Turn "${label}" is outside the calendar.`);
  const day =
    ((t.fy - 1) * cal.quartersPerYear + (t.q - 1)) * cal.daysPerQuarter +
    (t.d - 1);
  return day * tpd + t.t;
}

export function labelOf(ord: number, cal: Calendar): string {
  if (ord === 0) return GENESIS;
  const tpd = turnsPerDay(cal);
  const day = Math.floor((ord - 1) / tpd);
  const t = ((ord - 1) % tpd) + 1;
  const d = (day % cal.daysPerQuarter) + 1;
  const quarters = Math.floor(day / cal.daysPerQuarter);
  const q = (quarters % cal.quartersPerYear) + 1;
  const fy = Math.floor(quarters / cal.quartersPerYear) + 1;
  return formatTurn({ fy, q, d, t });
}

/** Wall-clock time at the start of a slot, for example "09:15". */
export function clockOf(label: string, cal: Calendar): string {
  const { t } = parseTurn(label);
  const mins = toMinutes(cal.dayStart) + Math.max(0, t - 1) * cal.slotMinutes;
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

/** Day 1 of the simulation is a Monday. Weekends are not simulated. */
export function describeTurn(label: string, cal: Calendar): string {
  const t = parseTurn(label);
  if (t.t === 0) return 'before the first working day';
  const dayIndex =
    ((t.fy - 1) * cal.quartersPerYear + (t.q - 1)) * cal.daysPerQuarter +
    (t.d - 1);
  return `${WEEKDAYS[dayIndex % 5]} FY${t.fy} Q${t.q} day ${t.d}, ${clockOf(label, cal)}`;
}

export const isFirstSlotOfDay = (label: string) => parseTurn(label).t === 1;

/** Journal file path for a turn, relative to the run folder. */
export function journalPathOf(label: string): string {
  const t = parseTurn(label);
  return `journal/fy${t.fy}/q${t.q}/d${t.d}/t${t.t}.jsonl`;
}
