# REQ-CRM-ID — Short IDs that a person can read

A person reads a URL and a page, and says an ID out loud ("visit 17"). A
UUID is too long for that. Each record that a person can open has a short
ID, and the UUIDs stay inside the database.

---

## REQ-CRM-ID-001 — No UUID in a URL or on a page

- **Status:** active
- **Source:** sean
- **Origin:** #1079
- **Type:** constraint
- **Priority:** P1
- **Statement:** The crm shall show a short ID, and never a UUID, in each
  URL, each redirect and the visible text of each page: the slug of an
  organisation (`/orgs/bakery`), and the number of a contact or an activity
  entry in its organisation, counted from 1 and never used again
  (`/orgs/bakery/contacts/2`, `/orgs/bakery/activity/17`).
- **Rationale:** Sean: "let's get into the habit of having short IDs
  everywhere. what's most human readable?" The edit pages showed a UUID in
  the URL and in the path title. The rules:
  - An organisation is its slug.
  - A record in an organisation is the number of that organisation, from 1.
    A visit and a note are both activity, so they share one counter, and an
    edit that changes a visit to a note keeps the number.
  - A global record (an invoice, later) is a prefix and a number, such as
    `INV-0042`.
  - A number is never used again. The table `org_counter` keeps the last
    number of each organisation and kind, so a removed contact 2 never
    comes back as a different person.
  - The UUIDs stay the primary keys and the foreign keys. The number is
    one more column, unique in its organisation (migration
    `004-numbers.sql`).
  - `orgPath`, `contactPath` and `activityPath` in `crm-be/src/org.ts`
    make each link and each redirect.
- **Verification:**
  - Test — `apps/crm/crm-be/src/id.test.ts` › "no page of a seeded organisation has a UUID in a URL (href, action, Location) or in the visible text"
  - Test — `apps/crm/crm-be/src/db.test.ts` › "004 numbers the existing records of each organisation in creation order, and starts the counters (REQ-CRM-ID-001)"
  - Test — `apps/crm/crm-be/src/routes/orgs/[slug]/contacts.test.ts` › "each organisation counts its contacts from 1, and a removed number is not used again (REQ-CRM-ID-001)"
- **Relations:** none
