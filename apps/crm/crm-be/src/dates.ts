/**
 * Every date and time of the crm (REQ-CRM-DATE-001). This module and
 * `ui/When.tsx` are the only code that formats a date. A page shows each
 * date with `<When>`.
 *
 * - A date shows as `2026-Nov-03`. A date and time shows as
 *   `2026-Nov-03 13:31`: 24-hour, with no seconds, always the full year.
 * - Each time is in London.
 * - `<When>` puts the full ISO 8601 value (seconds and offset) in the
 *   `datetime` attribute, and the full date and time with seconds in
 *   `title`.
 *
 * The database keeps two kinds of value: an ISO 8601 UTC time, and a date
 * as `YYYY-MM-DD` (from a date field).
 */

/** The seller works in the UK, so each date and time is in London. */
const TIME_ZONE = 'Europe/London';

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const DAY_MS = 24 * 60 * 60 * 1000;

const LONDON = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'longOffset',
});

/** The parts of an instant in London, as text. `offset` is `+01:00`. */
const londonParts = (instant: Date) => {
  const part = Object.fromEntries(
    LONDON.formatToParts(instant).map(({ type, value }) => [type, value]),
  );
  // `GMT` in winter, `GMT+01:00` in summer.
  const offset = part.timeZoneName.slice(3) || '+00:00';
  return {
    date: `${part.year}-${part.month}-${part.day}`,
    year: part.year,
    month: MONTHS[Number(part.month) - 1],
    day: part.day,
    time: `${part.hour}:${part.minute}`,
    seconds: part.second,
    offset,
  };
};

/** True for a date with no time: `YYYY-MM-DD`. */
const isDateOnly = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

/**
 * The instant of `value`. A date with no time is the start of that day in
 * London.
 */
const instantOf = (value: string) => {
  if (!isDateOnly(value)) return new Date(value);
  const utcMidnight = new Date(`${value}T00:00:00Z`);
  const { offset } = londonParts(utcMidnight);
  return new Date(`${value}T00:00:00${offset}`);
};

/** Today in London, as `YYYY-MM-DD`. */
export const today = () => londonParts(new Date()).date;

/**
 * `value` as a person reads it: `2026-Nov-03`, or `2026-Nov-03 13:31` with
 * `time`. A date with no time never shows a time.
 */
export const formatDate = (
  value: string,
  { time = !isDateOnly(value) }: { time?: boolean } = {},
) => {
  const p = londonParts(instantOf(value));
  const date = `${p.year}-${p.month}-${p.day}`;
  return time && !isDateOnly(value) ? `${date} ${p.time}` : date;
};

/** `value` as full ISO 8601, with seconds and the London offset. */
export const isoDateTime = (value: string) => {
  const p = londonParts(instantOf(value));
  return `${p.date}T${p.time}:${p.seconds}${p.offset}`;
};

/** `value` as the full date and time, with seconds: `2026-Nov-03 13:31:05`. */
export const fullDateTime = (value: string) => {
  const p = londonParts(instantOf(value));
  return `${p.year}-${p.month}-${p.day} ${p.time}:${p.seconds}`;
};

/** The number of days from today (London) to the date `date`. */
export const daysFromToday = (date: string) =>
  Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today()}T00:00:00Z`)) /
      DAY_MS,
  );

/**
 * The status of a next action on `date`, in words: `today`, `tomorrow`,
 * `in 3 days`, `1 day overdue`, `2 days overdue`. These words are status
 * text. A page shows them next to the date, never in place of it.
 */
export const dueWords = (date: string) => {
  const days = daysFromToday(date);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days > 1) return `in ${days} days`;
  return days === -1 ? '1 day overdue' : `${-days} days overdue`;
};
