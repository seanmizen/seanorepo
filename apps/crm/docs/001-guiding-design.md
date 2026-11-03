# 001: Guiding design

`apps/crm` is a homebrew CRM for one solo developer who sells software
services door to door. Most clients are on monthly rolling contracts. Some
clients also get ad-hoc charges.

This document sets the direction for the app. Later tickets build the
features. Each feature gets requirement IDs when a ticket builds it.

## Summary

A homebrew CRM is reasonable for a solo developer, because the scope is
narrow. Stripe can do all the payment, invoice, recurring and one-off billing
work. Do not build invoicing in the CRM.

The CRM keeps the relationship data. Stripe keeps the money data.

The two hard parts are:

1. The split between GDPR erasure and statutory retention.
2. The doorstep sign-up flow.

## Main features

1. **Contacts and organisations.** People, businesses, addresses and
   geo-coordinates. Each record shows its lawful basis and the source of the
   data.
2. **Territory view.** A map of streets and visits, with a status for each
   address: not visited, no answer, call back, do not knock. A standard CRM
   does this badly for door-to-door work.
3. **Pipeline.** Stages such as lead → visited → follow-up → quoted →
   won/lost. Every open deal has a next action and a date.
4. **Activity log.** Visits, calls, emails, notes and photos. On a phone, the
   user must be able to log a visit in about 10 seconds.
5. **Tasks and reminders.** A "today" list, made from the next-action dates.
6. **Service catalogue.** Monthly plans and one-off items. The CRM mirrors
   them to Stripe Products and Prices.
7. **Quotes and contracts.** A quote goes to the client as a link, and the
   client accepts it. The CRM records the T&Cs version that the client
   accepted, and the time of acceptance.
8. **Billing view.** A read-only mirror of Stripe subscriptions, invoices,
   payments and failed payments. Stripe webhooks keep it current.
9. **Reports.** MRR, churn, aged debt, and conversion by area or street.
10. **GDPR tools.** Data export for subject access requests (DSARs), erasure,
    a retention schedule with automatic purge, a suppression list, and an
    audit log.
11. **Auth.** One login system for the admin and for clients. See
    [Auth and tenancy](#auth-and-tenancy).
12. **MCP server.** Claude reads the CRM and changes it, as an assistant.
    See [MCP server](#mcp-server).

## Auth and tenancy

Keep it simple. Each concern has one obvious place in the code, so that a
debug session can find it with grep.

### One login system

- **The admin and the clients use the same flow.** Sean is the admin. He
  uses the flow every day before the client portal ships, so he finds the
  problems first.
- **No Cloudflare Access.** It adds a second login for the admin. Then the
  admin flow is different from the client flow.

### Sign-in

- **Email link, with a code as a backup.** The email contains a link and a
  6-digit code. The link opens a page with a "Sign in" button. The button
  sends the POST. Reason: email scanners (for example Outlook Safe Links)
  open every link. If the link itself used the token, a scanner would use it
  up before the person clicks.
- **The token.** It is single-use and it expires after 15 minutes. The
  database stores only its hash.
- **Email provider.** A transactional email provider sends the email
  (Postmark, Resend or SES).
- **Passkey for clients.** Optional. After the first login, the app offers
  "Save a passkey on this phone". Use [SimpleWebAuthn][simplewebauthn].
- **Rate limits.** The email-link endpoint and the code endpoint have rate
  limits by email address and by IP.

### The admin role

- **The admin role requires a passkey.** An email link alone gives a
  session. The admin area opens only after a passkey sign-in.
- **One config key holds the admin email.** No signup flow can give the
  admin role to a person.

### Sessions

- **Cookie.** The session lasts 60–90 days. The cookie is `HttpOnly`,
  `Secure` and `SameSite=Lax`.
- **Sessions list.** It shows the device, the browser and the last-seen time
  for each session. Each session has a revoke button.
- **"Sign out everywhere else".** One button revokes all other sessions.

### Lost device

Passkeys sync through iCloud Keychain, Google Password Manager or 1Password.
If Sean loses a phone, he does these steps:

1. Sign in on another device.
2. Revoke the session of the lost phone.
3. Lock the lost phone with Find My.

Register two passkeys on day one: one in iCloud Keychain and one in a
different manager. The passkey list shows a name and a last-used date for
each passkey.

### Lockout recovery

- **No recovery codes and no admin recovery by email.** Recovery by email
  cancels the passkey requirement.
- **SSH access to the box is the root of trust.** One backend command does
  the recovery:

  ```bash
  docker exec backend-crm bun run admin:recover <email>
  ```

  The command does these steps:

  1. It deletes the passkeys of the admin.
  2. It revokes all sessions of the admin.
  3. It prints a single-use enrolment link. The link expires after 15
     minutes.

- **A backend test covers the command.**

### Clients and billing

- The [Stripe Customer Portal][stripe-portal] covers invoices, payment
  methods and cancellation.
- The CRM client portal comes later, with the first feature for clients
  (quotes, contracts or documents).

### Tenancy model

```text
Person (one login, one email)
  └── Membership (role: owner | staff)
        └── Organisation (one slug, one Stripe Customer)
```

- One person can belong to many organisations. After login, a person with
  more than one organisation sees a picker.
- Each organisation is a separate Stripe Customer. It has its own invoices,
  VAT details and Direct Debit mandate.
- Each person has one email. There is no account linking.
- GDPR erasure applies to the person and to their memberships. The statutory
  records of the organisation follow the retention tier (see
  [Two tiers of data](#two-tiers-of-data)).

### URLs

URLs are readable, and a person can share them. A URL is never a
credential. The session controls access.

```text
crm.seanmizen.com/orgs/acme-plumbing
crm.seanmizen.com/orgs/acme-plumbing/invoices/INV-0042
crm.seanmizen.com/orgs/acme-plumbing/quotes/website-refresh
```

- Each organisation is under `/orgs/`. The only slug that an organisation
  cannot have is `new`, because `/orgs/new` is the new-lead page.

- A signed-out visitor gets the sign-in page. After sign-in, the visitor
  returns to the same URL.
- A slug comes from a trading name. Reason: the business name of a sole
  trader can be personal data.
- On erasure, the app deletes the slug too. Old links then return 404.

## MCP server

The MCP server lets Claude act as the assistant of the seller. Claude reads
the CRM and changes it, from the Claude apps (web, desktop and phone) and
from Claude Code. Sean can use a Pro or a Max plan: a connector needs no API
key and no API billing. Keep it simple, with one obvious place in the code.

- **Location.** The server is part of `crm-be`. It uses the Streamable HTTP
  transport at `/api/mcp`, with [`@modelcontextprotocol/sdk`][mcp-sdk].
  There is no separate app.
- **One file.** `apps/crm/crm-be/src/mcp.ts` registers all tools. Each tool
  calls the same service functions as the routes, and checks its values
  with the record forms (REQ-CRM-FORM-001). Do not duplicate logic.
- **Admin only.** Each request needs a bearer token of the admin. The check
  runs on each request, as on each admin route.
- **OAuth for the Claude apps.** A claude.ai connector signs in with OAuth
  2.1. The CRM is the resource server and the authorization server, as the
  MCP authorization spec says: protected resource metadata, authorization
  server metadata, dynamic client registration and PKCE. The authorize page
  is a CRM page: the admin, in a passkey session, taps Allow. Sean adds the
  connector in Claude (Settings, Connectors) with the URL
  `https://crm.seanmizen.com/api/mcp`.
- **Tokens for Claude Code.** A personal access token in a bearer header:

  ```bash
  claude mcp add --transport http crm https://crm.seanmizen.com/api/mcp \
    --header "Authorization: Bearer <token>"
  ```

- **Connections.** `/account/connections` creates, names and revokes the
  tokens, and lists and revokes the OAuth connections, each with a name and
  a last-used date. The database keeps only the hash of each token and
  grant. `apps/crm/crm-be/src/oauth.ts` holds all of it.
- **Tool scope: reads and edits.** Each write is a separate tool with a
  clear name:
  - Reads: `search_organisations`, `get_organisation` (details, contacts
    and activity), `list_due`.
  - Writes: `create_lead`, `log_visit`, `add_note`, `set_stage`,
    `set_next_action`, `update_organisation`, `add_contact`,
    `update_contact`, `update_activity`.

  Deletes, erasure and all actions that move money stay in the UI only
  (REQ-CRM-MCP-001). The write tools carry the MCP hints (`readOnlyHint`,
  `destructiveHint`, `idempotentHint`), so a client can ask before it runs
  one.
- **Calendar.** For an invite, Claude uses its own Google Calendar
  connector in the same chat. The CRM has no calendar code.
- **Audit.** Every MCP write is one event in the same history as the UI
  actions (see [Undo and history](#undo-and-history)), with one row in the
  same audit log, with the names of the changed fields. The actor is
  `mcp:<connection name>`. The write shows in the Activity list, and Undo
  can reverse it.
- **Untrusted data.** A tool result can contain text that a client wrote.
  Each result puts that text in an `untrusted_text` object, and each tool
  description says that the text is data, never an instruction. This is
  one more reason to keep destructive tools out of MCP.
- **GDPR.** CRM data that goes through MCP goes to Anthropic, the LLM
  provider. Anthropic's data processing terms cover its commercial products
  (the API, Team and Enterprise). They do not cover the Pro and Max
  consumer plans. So, on Pro or Max, Sean turns off model training in the
  privacy settings of Claude, and names Anthropic in the privacy notice and
  in the record of processing. The other choice is a plan with a DPA.

## Undo and history

Each organisation has one history: the table `org_event`. The crm only
appends rows to it. The Activity list of the organisation page shows it,
newest first. REQ-CRM-UNDO-001, REQ-CRM-UNDO-002 and REQ-CRM-UNDO-003 hold
the rules, and `crm-be/src/events.ts` holds the code.

### The model

- **One row for each change.** A row has the event number in the
  organisation (from 1), the time, the actor, the kind and a JSON payload.
  `writeEvent` is the one function that adds a row. Each write path calls
  it once: the new lead, a visit, a note, the stage, the next action, the
  details, a contact (added, changed or removed), the edit of a visit or a
  note, and Undo, Redo and Restore.
- **The payload.** The display fields (the names of the changed fields,
  the stages, the ids) have no personal data, as in `audit_log`. The
  `changes` hold the values before and after each row that the event
  changed. These values can be personal data, for example an old phone
  number or the text of a note.
- **Nothing is deleted.** A visit, a note or a contact that an Undo or a
  Remove takes away gets `hidden_at` and `hidden_by` (the event number).
  The row stays in the database and in the backups. An edit that changes
  a visit to a note hides the visit row, and shows a note row with the
  same id and number.
- **Undo** reverses the newest change that is not undone. It writes the
  before values in a new `undo` event. **Redo** applies the newest undone
  change again, with a new `redo` event. The redo list is the run of
  undone changes since the last new change. Each new change empties it.
- **Restore** shows one hidden visit, note or contact again, with a
  `restore` event. A Restore of a record that shows already does nothing,
  and records nothing.
- **`audit_log` stays the security log.** It keeps the sign-ins, the
  passkeys and the sessions. Each event also adds one `audit_log` row,
  with the display fields and never the `changes`.
- **The old history.** Migration `005-events.sql` made one event for each
  old organisation, visit, note and `audit_log` row of an organisation, in
  time order. An old visit or note has its change: Undo hides it. The old
  log kept no values of each other change, so Undo stops at it.

### The page

- Undo and Redo are two keys at the top of the Activity box, always in
  the same place. A key that cannot act is off, with the reason in its
  hover text (REQ-CRM-BUTTON-001).
- An Undo, a Redo or a Restore is a line in the Activity list, for
  example "Undo of Visit 17: Spoke."
- Hidden records do not show by default. The open Activity list starts
  with `Show hidden` (`?hidden=1`). It shows each hidden visit, note and
  contact, marked "hidden", with `Restore`. `Hide hidden` goes back.

### Erasure

The payloads can hold personal data, so an erasure must reach them too.
When a person asks for erasure (see [Two tiers of data](#two-tiers-of-data)):

1. Redact the values of the person in each payload: each `changes` value
   of their `person` row, and each `changes` value of a hidden record
   that is about them (the text of a visit or a note). Set
   `"redacted": true` on each event that changed.
2. Delete or redact their hidden records, as the relationship tier says.
3. Add the record IDs to the erasure log, as for each other erasure.

Undo and Redo stop at a redacted event and say why: its values are gone,
so the crm cannot write them back. Redaction is the one change to an
existing row of `org_event`. The crm has no erasure tool. The history
gives it two parts: the `redacted` flag, and the stop in `historyOf`.

## GDPR and record-keeping

### Two tiers of data

The duty to erase and the duty to keep records do not conflict. Under UK
GDPR, the right to erasure has exemptions:

- [Art. 17(3)(b)][gdpr-17]: compliance with a legal obligation.
- [Art. 17(3)(e)][gdpr-17]: the establishment, exercise or defence of legal
  claims.

So the CRM puts its data into two tiers:

| Tier | Contents | On an erasure request |
|---|---|---|
| Relationship | Prospects, notes, visit logs, phone numbers, photos | Delete it immediately |
| Statutory | Invoices, payments, contracts, billing name and address, VAT data | Restrict processing, set a purge date, and delete on that date |

### Retention rules

- **Retention period.** HMRC wants records for
  [5 years after the 31 January filing deadline][hmrc-sole] for a sole trader.
  It wants [6 years for a limited company][hmrc-ltd] and
  [6 years for VAT records][hmrc-vat]. The
  [Limitation Act 1980][limitation] gives 6 years for contract claims. In
  practice, keep statutory records for 7 years after the last transaction.
  Then purge them automatically.
- **Prospects that never sign.** Use legitimate interests as the lawful
  basis. Write a short legitimate interests assessment (LIA). Purge a
  prospect automatically after about 12 months with no activity.
- **"Do not knock" requests.** The law permits a minimal suppression record
  (the address only), so that the CRM respects the objection.
- **Free-text notes.** The client can see them through a DSAR. Write them
  with that in mind.
- **Erasure and backups.** The ICO accepts erased data in backups if the data
  is "beyond use" and the backups expire. Keep an erasure log of record IDs.
  Apply the log again after every restore.
- **ICO data protection fee.** The [fee][ico-fee] is almost certainly
  necessary (tier 1, about £52 a year).
- **Other countries.** A design to UK GDPR also covers most of the EU rules
  and most of CCPA.

### The main legal risk: doorstep consumer sales

The main legal risk comes from consumer law, not from GDPR. A sale to a
*consumer* at their door is an off-premises contract under the
[Consumer Contracts Regulations 2013][ccr-2013]. These rules apply:

1. The client gets 14 days to cancel.
2. The seller must give the cancellation information in writing.
3. If the seller does not give that information, the seller commits a
   criminal offence. The cancellation period also extends to 12 months.
4. If the work starts within the 14 days, the client must ask for that
   explicitly.

The sign-up flow must do all of this. B2B sales are exempt.

## Stripe

### Scope

Stripe does all of the billing work:

- **Monthly rolling contracts.** Stripe Billing subscriptions. The Customer
  Portal lets clients change their card and cancel.
- **Ad-hoc charges.** Add invoice items to the next subscription invoice (one
  bill each month). Or send a one-off invoice with a hosted payment page.
- **Bacs Direct Debit.** The default for UK monthly clients. It costs less on
  larger amounts, and it does not fail when a card expires.
- **Stripe Tax.** Use it only after VAT registration (the threshold is £90k).
- **Stripe is not the accounting system.** Making Tax Digital for Income Tax
  starts in April 2026 for income over £50k, and in April 2027 for income over
  £30k. Export to FreeAgent or Xero.

### Fees

These UK fees are **approximate**. Stripe changes its prices. Check the live
[Stripe UK pricing page][stripe-gb-pricing] before you rely on a number.

| Item | Fee (approximate) |
|---|---|
| UK standard cards | 1.5% + 20p (premium cards ~1.9% + 20p) |
| EEA / international cards | ~2.5% + 20p / ~3.25% + 20p, plus 2% for currency conversion |
| Bacs Direct Debit | ~1% + 20p, capped at £4 |
| Billing (subscriptions) | 0.7% of billing volume |
| Invoicing (one-off invoices) | 0.4% per paid invoice |
| Disputes | ~£20 for each card dispute |
| Monthly fee | None |

Example: £100/month by Bacs costs about £1.20 + £0.70 = £1.90 (1.9%). By
card, it costs about £1.70 + £0.70 = £2.40. On £5k MRR, the fees are about
£100–£120 a month.

### Doorstep sign-up

Tap to Pay on iPhone and Bluetooth readers need a native app with the
[Stripe Terminal SDK][stripe-tap]. A PWA cannot use them. So the doorstep
flow is:

1. The CRM shows a QR code, or texts a Stripe Checkout link to the client.
2. The client signs the Bacs mandate on their own phone.
3. The client accepts the T&Cs (Checkout terms-of-service consent).

This flow needs no hardware and no app store.

Never store card data. Checkout keeps the PCI scope at SAQ A.

## SQLite and backups

- The database is SQLite in [WAL mode][sqlite-wal].
- **Primary backup.** [Litestream][litestream] streams the database
  continuously to Cloudflare R2. This gives point-in-time restore, and
  recovery if the box is lost.
- **The R2 bucket is in the EU jurisdiction.** The backup data stays inside
  the EU. Cloudflare has no UK jurisdiction. UK GDPR allows a transfer to
  the EEA under the UK adequacy regulations. Cloudflare fixes the
  jurisdiction when it makes a bucket, and only the EU endpoint
  (`<account_id>.eu.r2.cloudflarestorage.com`) reaches the bucket. The
  README has the bucket, the endpoint and the restore command.
- **OneDrive.** Litestream cannot write to OneDrive. A nightly job makes a
  [`VACUUM INTO`][sqlite-vacuum] snapshot, encrypts it with [`age`][age], and
  copies it with [`rclone`][rclone-onedrive]. Encrypt it, because it is
  personal data on a consumer cloud.
- **Never put the live `.db` file in a synced folder.** The OneDrive client
  will corrupt it.
- **Use a fixed backup retention** (for example 90 days), so that erased
  data expires from the backups.
- **A scripted restore test runs every month.**
- Litestream and the nightly snapshot run as sidecar containers in the same
  compose file as the app.

## Desktop and mobile parity

The app is one responsive, mobile-first frontend. The user installs it as a
PWA. It has a small offline capture queue for visits, notes and new leads.
Payments always happen online, on the client's phone.

## Offline sync

### IndexedDB

[IndexedDB][mdn-indexeddb] is a database in every browser. Each origin gets
its own private store of structured objects in object stores, with indexes
and transactions. The data persists across a tab close, a reboot and offline
periods. Use the [`idb`][idb] wrapper.

### Outbox design

1. Every offline change goes into a local `outbox` store, with a UUID that
   the client makes.
2. A sync loop sends the outbox to `POST /api/sync`. The server applies each
   item idempotently by UUID, so a retry cannot make duplicates.
3. When the server confirms an item, the client deletes it from the outbox.

**Offline work is append-only:** create a visit, a note, a new lead or a
photo. This removes merge conflicts. Edits to existing records, and all
actions that touch money, are online-only.

### iOS constraints

- Safari [deletes the storage of a site][webkit-7day] after 7 days with no
  visit. Home-screen PWAs are exempt. Install the CRM to the home screen, and
  call `navigator.storage.persist()`.
- iOS has no Background Sync API. Sync runs only while the app is open:
  - when the app opens
  - on return to the foreground (`visibilitychange`)
  - on the `online` event
  - on a retry timer

  Data from a session that closed offline stays safe in IndexedDB until the
  next open.
- `navigator.onLine` is not reliable. The app counts itself online only when
  a server request succeeds.

### Sync indicators

The browser shows no sync status, so the app must show it:

- **Header badge, always visible.** A green tick when synced. An amber
  "3 waiting" with a cloud-off icon when items wait. A tap opens the sync
  screen.
- **Sync screen.** Pending items, the time of the last successful sync,
  failed items with the server error, and a "sync now" button.
- **Pending dot.** Each unsynced record shows a "pending" dot in every list.
- **Home-screen icon badge.** Use [`navigator.setAppBadge(n)`][mdn-badge]
  (iOS 16.4+, home-screen apps only, needs notification permission).
- **Guard against data loss.** Block sign-out, and warn before the user
  clears site data, while the outbox has items.

### GDPR on the device

The phone holds only the outbox and the data for the current route. It never
holds a full copy. The client deletes synced items from the device.

## Sources

From the initial write-up:

- https://stripe.com/pricing
- https://stripe.com/pricing/local-payment-methods
- https://support.stripe.com/questions/june-2024-pricing-updates-for-bacs-direct-debit?locale=en-GB
- https://docs.stripe.com/payments/payment-methods/bacs-debit?locale=en-GB
- https://docs.stripe.com/terminal/payments/setup-reader/tap-to-pay
- https://litestream.io

Linked in this document:

- [Stripe UK pricing (live)][stripe-gb-pricing]
- [UK GDPR, Article 17][gdpr-17]
- [Consumer Contracts Regulations 2013][ccr-2013]
- [Limitation Act 1980, section 5][limitation]
- [HMRC: records for the self-employed][hmrc-sole]
- [HMRC: limited company records][hmrc-ltd]
- [HMRC: VAT record keeping][hmrc-vat]
- [ICO: data protection fee][ico-fee]
- [SQLite: WAL mode][sqlite-wal]
- [SQLite: `VACUUM INTO`][sqlite-vacuum]
- [age][age]
- [rclone: OneDrive][rclone-onedrive]
- [MDN: IndexedDB][mdn-indexeddb]
- [`idb`][idb]
- [WebKit: 7-day cap on script-writable storage][webkit-7day]
- [MDN: `navigator.setAppBadge()`][mdn-badge]
- [SimpleWebAuthn][simplewebauthn]
- [Stripe Customer Portal][stripe-portal]
- [`@modelcontextprotocol/sdk`][mcp-sdk]

[stripe-gb-pricing]: https://stripe.com/gb/pricing
[stripe-tap]: https://docs.stripe.com/terminal/payments/setup-reader/tap-to-pay
[litestream]: https://litestream.io
[gdpr-17]: https://www.legislation.gov.uk/eur/2016/679/article/17
[ccr-2013]: https://www.legislation.gov.uk/uksi/2013/3134/contents
[limitation]: https://www.legislation.gov.uk/ukpga/1980/58/section/5
[hmrc-sole]: https://www.gov.uk/self-employed-records/how-long-to-keep-your-records
[hmrc-ltd]: https://www.gov.uk/running-a-limited-company/company-and-accounting-records
[hmrc-vat]: https://www.gov.uk/guidance/record-keeping-for-vat-notice-70021
[ico-fee]: https://ico.org.uk/for-organisations/data-protection-fee/
[sqlite-wal]: https://www.sqlite.org/wal.html
[sqlite-vacuum]: https://www.sqlite.org/lang_vacuum.html#vacuuminto
[age]: https://github.com/FiloSottile/age
[rclone-onedrive]: https://rclone.org/onedrive/
[mdn-indexeddb]: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
[idb]: https://github.com/jakearchibald/idb
[webkit-7day]: https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/
[mdn-badge]: https://developer.mozilla.org/en-US/docs/Web/API/Navigator/setAppBadge
[simplewebauthn]: https://simplewebauthn.dev
[stripe-portal]: https://docs.stripe.com/customer-management
[mcp-sdk]: https://github.com/modelcontextprotocol/typescript-sdk
