# REQ-CRM-DATE — Every date has one format

The crm shows each date and each time in one format, from one helper. A
person reads the same form everywhere, and the full value is always in the
markup.

---

## REQ-CRM-DATE-001 — One format for each date and time

- **Status:** active
- **Source:** sean
- **Origin:** #1063
- **Type:** constraint
- **Priority:** P1
- **Statement:** The crm shall show each date as `2026-Nov-03` and each
  date and time as `2026-Nov-03 13:31` (24-hour, the full year, London
  time), in a `<time>` element whose `datetime` attribute holds the full ISO
  8601 value with seconds and the offset, and whose `title` holds the full
  date and time with seconds.
- **Exception:** A native date field (`<input type="date">`) shows the
  format of the browser. A date and time shows its seconds only where they
  are necessary, for example in an audit log.
- **Rationale:** Mixed date formats on one page made the seller stop and
  read. `2026-Nov-03` sorts as text, has no day-month ambiguity, and names
  the month. The hover and the bare theme keep the full value. Relative
  status words such as `2 days overdue` are status text, not a date: they
  can show, but always next to the date, never in place of it. One helper
  (`crm-be/src/dates.ts`, shown by `crm-be/src/ui/When.tsx`) formats each
  date, so no page makes its own format.
- **Verification:** Test — `apps/crm/crm-be/src/dates.test.ts` › "every date and time on each page is a <time> with the full value, in the one format (REQ-CRM-DATE-001)"
- **Relations:** none
