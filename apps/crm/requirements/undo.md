# REQ-CRM-UNDO — Undo, Redo and Restore never delete data

Each change to an organisation is one row of its history. A person can undo
each change and redo it, and restore one hidden record. None of these
deletes data: the history only grows, and a record that goes away is hidden.

---

## REQ-CRM-UNDO-001 — One history that only grows, and no delete

- **Status:** active
- **Source:** sean
- **Origin:** #1089
- **Type:** constraint
- **Priority:** P2
- **Statement:** When the crm writes a change to an organisation, including
  an Undo, a Redo or a Restore, it shall append exactly one row to
  `org_event` through `writeEvent` in `crm-be/src/events.ts`, and change no
  row of `org_event`, and delete no row of `org_event`, `visit`, `note` or
  `membership`.
- **Rationale:** Sean: "all undo/redo events should be recorded and data
  must never, ever be deleted this way." The rules:
  - A visit, a note or a contact that an Undo or a Remove takes away gets
    `hidden_at` and `hidden_by` (the event number). The row stays in the
    database and in the backups.
  - An edit that changes a visit to a note hides the visit row and shows a
    note row with the same id and number. Undo shows the visit row again.
  - The payload of an event holds the display fields (no personal data)
    and `changes`: the values before and after each row that it changed.
    Undo writes the before values in a new `undo` event. Redo writes the
    after values in a new `redo` event.
  - `audit_log` stays the security log. `writeEvent` adds one `audit_log`
    row for each event, with the display fields and never `changes`.
  - Migration `005-events.sql` fills `org_event` from the old visits,
    notes and `audit_log` rows of each organisation, in time order.
  - GDPR erasure is the one exception. It redacts the personal values in
    the payloads: see "Undo and history" in
    `apps/crm/docs/001-guiding-design.md`.
- **Verification:**
  - Test — `apps/crm/crm-be/src/events.test.ts` › "no row count goes down through a long sequence of changes, Undo, Redo and Restore (REQ-CRM-UNDO-001)"
  - Test — `apps/crm/crm-be/src/events.test.ts` › "no code of an organisation runs DELETE, and no code changes a row of org_event (REQ-CRM-UNDO-001)"
  - Test — `apps/crm/crm-be/src/events.test.ts` › "<kind>: undo twice, then redo twice, gives each state again, and no row count goes down (REQ-CRM-UNDO-001, REQ-CRM-UNDO-002)": each write path and each Undo and Redo adds exactly one event.
  - Test — `apps/crm/crm-be/src/mcp.test.ts` › "each write tool is one event in the history, with the actor mcp:<name>, and Undo on the page reverses it (REQ-CRM-UNDO-001, REQ-CRM-UNDO-002)"
  - Test — `apps/crm/crm-be/src/db.test.ts` › "005 fills org_event from the old history of each organisation, in time order (REQ-CRM-UNDO-001)"
  - Test — `apps/crm/crm-be/src/db.test.ts` › "005 on a database with no rows adds the tables and no event (REQ-CRM-UNDO-001)"
- **Relations:** none

---

## REQ-CRM-UNDO-002 — Undo and Redo are one stack

- **Status:** active
- **Source:** sean
- **Origin:** #1089
- **Type:** functional
- **Priority:** P2
- **Statement:** When a person taps Undo or Redo on the page of an
  organisation, the crm shall reverse the newest change that is not
  undone, or apply again the newest undone change since the last new
  change, so that each new change empties the redo list.
- **Rationale:** Sean: "you can undo any and all events AND redo (if a redo
  stack exists, wiped by new actions of course.)" The rules
  (`historyOf` in `crm-be/src/events.ts`):
  - Undo and Redo work for each kind of change: a visit, a note, the
    stage, the next action, the details, a contact (added, changed or
    removed), the edit of a visit or a note, and a Restore. A change from
    an MCP tool is the same kind of change.
  - Undo stops at a change that it cannot reverse, and says why: the new
    lead (the first event), a change from before migration 005 (the old
    log kept no values), and a change with erased personal data.
  - The post of a key names the event that the page showed. When the
    newest event is a different one (a second tap, or an old page), the
    post changes nothing.
  - An Undo that writes back a URL slug or an email address that another
    record has now changes nothing, and the page says why.
- **Verification:**
  - Test — `apps/crm/crm-be/src/events.test.ts` › "<kind>: undo twice, then redo twice, gives each state again, and no row count goes down (REQ-CRM-UNDO-001, REQ-CRM-UNDO-002)", one test for each kind of change
  - Test — `apps/crm/crm-be/src/events.test.ts` › "a new change after an Undo empties the redo list (REQ-CRM-UNDO-002)"
  - Test — `apps/crm/crm-be/src/events.test.ts` › "a second tap on Undo changes nothing: the post names the event that the page showed (REQ-CRM-UNDO-002)"
  - Test — `apps/crm/crm-be/src/events.test.ts` › "Undo stops at the new lead, at an event older than Undo and at an erased event, and says why (REQ-CRM-UNDO-002)"
- **Relations:** depends-on REQ-CRM-UNDO-001

---

## REQ-CRM-UNDO-003 — Restore shows one hidden record, one time

- **Status:** active
- **Source:** sean
- **Origin:** #1089
- **Type:** functional
- **Priority:** P2
- **Statement:** When a person taps Restore on a hidden visit, note or
  contact, the crm shall clear its `hidden_at` and append one `restore`
  event only while the record is hidden, so that a second Restore changes
  and records nothing.
- **Rationale:** Sean: "ideally you can restore singular events too so long
  as their restoration is idempotent (e.g. 'restore this visit')." Restore
  is only on a hidden record:
  - Hidden records do not show by default. `Show hidden` (`?hidden=1`)
    shows each one, marked "hidden", with `Restore`.
  - The old row of a visit that an edit changed to a note is not a hidden
    record: its entry shows as the note. Undo of the edit brings it back.
  - A Restore is a new change: it empties the redo list, and Undo hides
    the record again.
- **Verification:**
  - Test — `apps/crm/crm-be/src/events.test.ts` › "Show hidden lists each hidden visit, note and contact with Restore, and a second Restore does nothing (REQ-CRM-UNDO-003)"
  - Test — `apps/crm/crm-be/src/events.test.ts` › "the old row of a visit changed to a note is not on the Show hidden list (REQ-CRM-UNDO-003)"
- **Relations:** depends-on REQ-CRM-UNDO-001
