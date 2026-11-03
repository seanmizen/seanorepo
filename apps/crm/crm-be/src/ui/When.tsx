import { formatDate, fullDateTime, isoDateTime } from '../dates';

/**
 * A date, or a date and time, as a person reads it (REQ-CRM-DATE-001):
 * `2026-Nov-03` or `2026-Nov-03 13:31`. The `datetime` attribute holds the
 * full ISO 8601 value, and `title` holds the full date and time with
 * seconds. So a hover shows the full value, and the bare theme keeps it in
 * an attribute. `value` is an ISO 8601 time or a `YYYY-MM-DD` date. `time`
 * is false to show only the date of a time.
 *
 * The theme shows each `<time>` in the mono font (the `time` rule in
 * `crm-fe/src/theme.css`), so the dates in a column line up.
 */
export const When = ({ value, time }: { value: string; time?: boolean }) => (
  <time dateTime={isoDateTime(value)} title={fullDateTime(value)}>
    {formatDate(value, time === undefined ? {} : { time })}
  </time>
);
