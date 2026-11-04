# crm

A homebrew CRM for a solo developer who sells software services door to door.
It keeps contacts, visits, the pipeline and the GDPR records. Stripe keeps the
billing. After sign-in, the seller has these pages:

- `/` and `/orgs`: the Plan, one list of every organisation (one handler,
  `routes/index.tsx`). The page is a rack over a band:
  - The glass reads the first organisation of the list (its name, its next
    action and its due date), the counts of Overdue and Today, and the
    rows that show. The plate keys are the pager: `Prev` and `Next`, 50
    rows to a page.
  - The control unit: Search (name or postcode, and `New lead`), Stage
    (`All` and one key for each stage) and Sort. The sort keys are `Due`
    (the default), `Date added` and `Name`. `Date added` and `Name` sort
    ascending (green LED), then descending (red LED), then go back to
    `Due`.
  - The band groups the organisations by the date of the next action:
    Overdue, Today, Next 7 days, Later and None. The sort sets the order in
    each group. `Due` puts the oldest due date first, then the newest last
    activity (the newest visit, note or add date; a hidden visit or note
    does not count). Each row shows the name (a link to `/orgs/<slug>`),
    the stage, the next action, its date, the last activity (the date
    added with the `Date added` sort) and the postcode. A row in Today
    shows only the word `today`, because its group has one day. The LED of
    a row, on the seam at its left, is lit when the next action is due.

  The URL holds the state: `?q=&stage=&sort=&dir=&page=`. With JavaScript,
  each key updates the page in place, and the focus stays where it was
  (see [Page rules](#page-rules)).
- `/orgs/new`: the new lead. The organisation form and the contact form,
  and one `Save` key. An empty URL slug comes from the name.
- `/orgs/<slug>`: one organisation. The LCD shows the name, the stage, the
  next action and its due date, and the last visit. The modules:
  - **Log**: the `Visit note` field, then the Save as keys. `No answer`,
    `Spoke`, `Call back`, `Not interested` and `Do not knock` save a visit
    with the note. `Note only` saves the text as a note. `Do not knock`
    also sets the stage to Lost.
  - **Stage**: one latching key for each stage. Each key saves.
  - **Next action**: the action, its due date and `Save`.
  - **Add a contact**: the contact form and `Save`.

  The boxes: **Activity** (`Undo` and `Redo`, then every event, newest
  first, in a `<details>` that is closed until a tap), **Contacts** (each
  with `Edit` and `Remove`) and **Details** (with `Edit`). Each visit and
  note in Activity shows its number, for example `Visit 17: Spoke.`. See
  [Undo and history](#undo-and-history).
- `/orgs/<slug>/edit`, `/orgs/<slug>/contacts/<number>` and
  `/orgs/<slug>/activity/<number>`: the edit pages. Each one is the same
  form as its create page, filled in (REQ-CRM-FORM-001). The LCD of an
  activity entry shows its `Type`: `Note`, or `Visit, <outcome>`.

### Short IDs

No URL and no page shows a UUID (REQ-CRM-ID-001):

- An organisation is its slug: `/orgs/bakery`.
- A contact or an activity entry has a number in its organisation, from 1:
  `/orgs/bakery/contacts/2`, `/orgs/bakery/activity/17`. A visit and a note
  share one counter.
- A number is never used again. The table `org_counter` keeps the last
  number of each organisation and kind, also after a delete.
- A global record (an invoice, later) gets a prefix and a number:
  `INV-0042`.

The UUIDs stay the primary keys and the foreign keys. `orgPath`,
`contactPath` and `activityPath` in `crm-be/src/org.ts` make each link and
each redirect, and `nextNumber` gives each new number.
- `/account`: the email and how this session signed in, with links to
  `/account/passkeys` and `/account/sessions`, and for the admin
  `/account/connections` (see [MCP for Claude](#mcp-for-claude)), and the
  `Reset demo data` button. Only the demo turns it on (see [Demo](#demo)).

Two pages are open to everyone:

- `/` for a signed-out visitor: the public home. The heading
  `seanmizen.com client portal`, and two links: `Sign in` and
  `Privacy notice`. It reads no data. It is the same URL as the list,
  with no redirect (`homePage` in `routes/index.tsx`).
- `/privacy`: the privacy notice. All of its text is in
  `crm-be/src/content/privacy.tsx`, as plain JSX, so a change to the
  notice is an ordinary PR. Change `PRIVACY_UPDATED` in that file with
  the text: the page shows it as "Last updated". The demo shows the same
  notice, and one line that all the demo data is fictional.

`GET /api/health` returns `{ "ok": true }`. The design is in
[docs/001-guiding-design.md](docs/001-guiding-design.md).

```bash
yarn workspace crm start           # http://localhost:4100
yarn workspace crm start:docker    # the same, in a dev container
yarn workspace crm prod:docker     # the prod image and Litestream (see Production), and the demo if .env.demo exists
yarn workspace crm test:types
yarn workspace crm-be test
```

## Layout

- `crm-be` renders every page with React on the server
  (`renderToStaticMarkup`). Bun runs the TSX directly, with no build step.
  It serves the pages, the API under `/api`, and the crm-fe build at
  `/static/`, all on port 4100.
- `crm-be/src/routes/` holds one file for each URL. Each file holds the
  Fastify route and a function that returns the parts of its page.
  `crm-be/src/index.ts` registers them.
- `crm-be/src/render.tsx` holds `renderPage(request, parts)`. It adds the
  doctype, the `<head>`, the asset tags from `crm-fe/dist/manifest.json`,
  and the page anatomy (see [Page anatomy](#page-anatomy)) around the parts.
- `crm-be/src/dates.ts` holds the London date and the date format, and
  `ui/When.tsx` shows a date (REQ-CRM-DATE-001). No other code formats a
  date.
- `crm-be/src/org.ts` holds the organisation: the stages, the visit
  outcomes, the slug maker, the paths (`orgPath`, `contactPath` and
  `activityPath`), `nextNumber` (see [Short IDs](#short-ids)) and
  `setPipeline` (the stage and the next action). The page for
  `/orgs/<slug>` is `routes/orgs/[slug].tsx`, and its forms post to
  `routes/orgs/[slug]/*`. The static route `/orgs/new` wins over
  `/orgs/<slug>`, and no slug is `new` (`RESERVED_SLUG`).
- `crm-be/src/forms/` holds one form definition for each record type:
  `organisation.ts`, `contact.ts` and `activity.ts` (the Log module). A
  definition has the fields, the labels, the placeholders and the checks.
  `ui/RecordForm.tsx` renders it, on the create page and on the edit page,
  and `parseForm` in `forms/form.ts` reads the post of both. No other code
  lists the fields of a record (REQ-CRM-FORM-001).
- `crm-be/src/activity.ts` holds the visits and the notes.
  `crm-be/src/contacts.ts` holds the contacts: add, change and remove.
- `crm-be/src/events.ts` holds the history of each organisation (the
  table `org_event`), and Undo, Redo and Restore. `writeEvent` is the one
  function that writes an event: each write to an organisation calls it
  once (REQ-CRM-UNDO-001). The Activity list of the organisation page
  (`routes/orgs/[slug].tsx`) shows the events, with the names and the
  text from the current tables.
- Each event also adds one `audit_log` row. The actor is the id of the
  signed-in person, or `mcp:<connection name>` for an MCP tool. The row
  keeps ids, stages, dates and the names of the changed fields. It never
  keeps personal data or the text of a note. A person who is not in the
  crm now shows as "a removed contact".
- `crm-be/src/mcp.ts` holds the MCP server and its tools, and
  `crm-be/src/oauth.ts` holds its connections: the tokens and OAuth (see
  [MCP for Claude](#mcp-for-claude)).
- `crm-be/src/ui/` holds the parts that pages share: `SiteNav`, `Footer`,
  `Device`, `Lcd`, `Module`, `Key` (and `Keys`, a row of keys), `LatchKey`,
  `Field`, `RecordForm`, `Box`, `RecordTable`, `When`, `Led` and `Label`.
  `ui/Passkey.tsx` holds the two passkey controls (add a passkey, sign in
  with a passkey), and `ui/AdminOnly.tsx` holds the 403 page of an admin
  route.
- `crm-fe` holds only what the browser runs: `src/theme.css`, `src/main.ts`,
  `src/morph.ts` and `src/passkeys.ts`. It has no React. Rsbuild builds them to
  `crm-fe/dist` with hashed names and a manifest. Only the pages with a
  passkey control load the `passkeys` entry: `/login`, `/account/passkeys`
  and the 403 page of an admin route.
- `shared` holds the API types.

`yarn workspace crm start` builds crm-fe once. Then Rsbuild builds crm-fe in
watch mode and Bun runs crm-be in watch mode. `yarn workspace crm-be test`
also builds crm-fe first, because the test of `/` reads the manifest.

## Undo and history

Each change to an organisation is one row of `org_event`, and the crm
never deletes data with an Undo, a Redo or a Restore (REQ-CRM-UNDO-001).
The design is in "Undo and history" in
[docs/001-guiding-design.md](docs/001-guiding-design.md).

- **Undo** (`POST /orgs/<slug>/undo`) reverses the newest change that is
  not undone, with a new `undo` event. **Redo**
  (`POST /orgs/<slug>/redo`) applies the newest undone change again. Each
  new change empties the redo list (REQ-CRM-UNDO-002). Each post names
  the event that the page showed, so a second tap changes nothing.
- **Hidden records.** Remove and Undo hide a visit, a note or a contact:
  the row gets `hidden_at` and `hidden_by` (the event number). The page
  does not show a hidden record. `Show hidden` (`?hidden=1`) shows each
  one, marked "hidden", with `Restore`
  (`POST /orgs/<slug>/activity/<number>/restore` or
  `POST /orgs/<slug>/contacts/<number>/restore`). A second Restore does
  nothing (REQ-CRM-UNDO-003).
- **Keys that cannot act.** `Undo`, `Redo` and `Show hidden` are always in
  their place. A key that cannot act is off (`disabled`), with the reason
  in its hover text and in its accessible description (REQ-CRM-BUTTON-001,
  the `off` prop of `ui/Key.tsx`). The rule is the same for each button
  of the crm: see [Page rules](#page-rules).
- **The old history.** Migration `005-events.sql` made the events from the
  old visits, notes and `audit_log` rows. Undo can hide an old visit or
  note, and stops at each other old change: the old log kept no values.

## Page anatomy

Each page has the same parts, from the top. `renderPage` builds them from
the `parts` that the route gives it.

1. **Nav** (`ui/SiteNav.tsx`, text). The title is the path of the URL, as on
   seanmizen.com: `/account/passkeys` reads `crm / account / passkeys`. Each
   part above the page is a link, and the page itself has a dim color. The title is
   the first element in `<body>`. The one exception is the demo: the demo
   line (`ui/DemoBanner.tsx`) comes first. Under the title, for a signed-in
   person, one line of links: `orgs · new lead · account · sign out`. The
   link to this page is text, with `aria-current="page"`. On a wide screen
   the theme shows these links in the footer row.
2. **Intro** (`intro`, text). At most one sentence.
3. **Rack** (`rack`). The device of the page on its side, at the full
   width (`ui/Rack.tsx`). Its units stack on one chassis, each with an ear
   at each end:
   - The display unit (`ui/DisplayUnit.tsx`): the glass as one strip of
     readings, legend over value, with the plate keys at its right. Each
     plate key has a caption under it: what the key acts on (Page 2 of 3),
     or why it is off (First page). A save or an error has its own line at
     the top of the glass.
   - The control unit (`ui/ControlUnit.tsx`): the modules side by side, on
     a grid of 12 columns. A module (`ui/Module.tsx`) is a `<section>` with
     its silkscreen label (an `<h2>`) at the top left, its value at the top
     right, and its keys and fields below.
4. **Band** (`band`). The data of the page, under the rack, at the full
   width (`ui/Band.tsx`): a `<section>` with an `<h2>`, then a real table.
   A gutter at the left names each group of rows (a `<tbody>` with a
   `<th scope="rowgroup">`). The LED of a row is on the chassis seam at its
   left.
5. **Footer** (`ui/Footer.tsx`, text). `privacy` and `top`. Each page has
   it, signed in or not.

A page that is not on the rack has the old parts in place of 3 and 4: the
device (`device`, a `Device` with an `Lcd` and modules on a grid of 6) in
the left column, and the help and the boxes (`help` and `boxes`, each box
a `ui/Box`) in the right column, in a 40/60 grid. Each page moves to the
rack in its own change (`docs/002-rack.md`, Order of work).

The layout has one width breakpoint, 960px (REQ-CRM-LAYOUT-002, in
`crm-fe/src/theme.css`):

- **Wide (960px and more):** the rack, then the band, each at the full
  width. The page is at most 1680px wide and starts at the top left. The
  nav links move to the footer row, next to `top`.
- **Narrow (less than 960px):** one column, in the order of the HTML. The
  ears go, each module has the full width, and each band row folds to two
  lines. The page margin is 1px.

The root font is 14px wide and 17px narrow, so no column width of the page
uses `rem`.

The glass and the band follow the rules of a real display
(REQ-CRM-LCD-002). An LED is only on metal: the chassis seam of a band row
(due), or the top of a latching key (pressed). No LED is inside a glass: a
status there is the status mark, an ink circle that blinks slowly. The
characters never move: each band row and each menu row has one height and
an arrow column at the left of its name, and a hover shows the arrow there.

To see each page, run the screenshot script from the repo root. It starts
crm-be on port 4110 with a new SQLite file in a temp folder, and puts sample
data and an admin passkey session in it. It touches no other database. It
shoots each page at the breakpoint minus 1px, the breakpoint, the
breakpoint plus 24px, 390px, 1200px and 1440px, in light and dark mode, and
prints each page that scrolls sideways.

```bash
node apps/crm/scripts/shoot.mjs [out-dir]
```

To test the morph (`crm-fe/src/morph.ts`) in a browser, run the morph
test from the repo root. It starts crm-be on port 4127 with a new SQLite
file, as the screenshot script does. In Chromium, it does a search, a
stage key and a sort key on the list, and a Log press on an organisation
page. After each press it checks the URL, the focus, the scroll position,
and that the page did not load again. It checks Back and Forward, a link
to a passkey page, and a fetch that fails. Then it does a Log press and a
search with `?theme=bare` and with JavaScript off.

```bash
node apps/crm/scripts/morph-test.mjs
```

## Theme

`crm-fe/src/theme.css` is the Pixel-3 theme of autosam: an instrument panel
with silkscreen labels, raised keys, LEDs and one red signal color. The one
other color is the green LED of a sort key in ascending order. Text links
use the ink color with an underline.

- **Bare.** Add `?theme=bare` to a URL to see the page with no page styles
  and no scripts. No page links to it.
- **Mode.** Light or dark, as the system sets it (`prefers-color-scheme`).
- **Dates.** A date shows as `2026-Nov-03`, and a date and time as
  `2026-Nov-03 13:31`, in London time, in the mono font. Each one is a
  `<time>` with the full ISO value in `datetime` and the full date and time
  with seconds in `title` (REQ-CRM-DATE-001). Words such as `2 days
  overdue` show next to the date, never in place of it.
- **Words.** The text of a page uses only the words on its keys, labels and
  legends. It never names a part of the panel (key, module, LCD), and help
  text is rare.

## Page rules

- The browser runs no React.
- Every page works as raw HTML, with no CSS and no JavaScript
  (REQ-CRM-BARE-001). The one exception is the passkey controls: WebAuthn
  needs JavaScript. With no JavaScript, the page says so, and email sign-in
  still works.
- Interactivity is an enhancement on top of a working HTML form or link,
  never a React component in the browser. Each form and in-app link
  updates the page in place (REQ-CRM-MORPH-001, `crm-fe/src/morph.ts`, on
  every page). The script sends the same request with `fetch` and morphs
  the response into the page with idiomorph. The focus and the scroll
  position stay, and the URL goes into history. On an error it sends the
  request again as a normal submit or load. A form or link with
  `data-reload` always loads the full page. Use it only for a post that
  redirects to a different origin, for example the OAuth consent form.
  Give a control an `id` when the morph must keep it as the same node.
- A button is always in its place (REQ-CRM-BUTTON-001). When it cannot
  act, it is off (`disabled`), with the reason in its hover text and in
  its accessible description. Use the `off` prop of `ui/Key.tsx`. With no
  JavaScript, the passkey keys are off, and the reason is "Passkeys need
  JavaScript". The one exception is `Enter as admin (demo)`: the live
  `/login` does not show it.
- Biome fails on `dangerouslySetInnerHTML` under `apps/crm` (see the
  `overrides` in the root `biome.json`).
- The text on a page uses only the words that the page shows: the labels
  of its fields, buttons and headings. It never uses the words of the code,
  such as key, module, LCD, outcome or record. If a sentence must tell what
  a button does, it names the button by its label, for example "Type a
  visit note, then tap Note only." Most buttons need no sentence.

## Sign-in

Each person signs in with an email link or a 6-digit code. There is no
signup page. At boot, crm-be makes the person for `CRM_ADMIN_EMAIL` if it is
missing. To add other people, add `person` rows.

1. `/login` takes an email address. If the email belongs to a `person`, crm-be
   sends one email with a link and a code. Both work one time, for 15
   minutes. The response is the same for an unknown email.
2. The link opens `/login/verify`, which shows a "Sign in" button. The button
   sends a POST. A GET never signs in, because email scanners open links.
3. `/login/code` takes the email and the code.

4. `/login` also has "Sign in with a passkey". It needs JavaScript. A
   passkey sign-in replaces the current session, if there is one: crm-be
   deletes its row.

A session is a random cookie (`crm_session`) that lasts 90 days.
`/account/sessions` lists the sessions, with a "Revoke" key for each one.
The "Revoke" key of this session is off. Its "Sign out" module has the key
"Everywhere else", which revokes all other sessions. It is off when there
is no other session. The nav of
each page has "sign out" for this session. Each page except the sign-in
pages, `/privacy`, `/api/health`, `/favicon.ico` and the MCP and OAuth
paths needs a session. `/api/mcp`, `/api/oauth/register`,
`/api/oauth/token` and each path under `/.well-known/` take no session
cookie: `/api/mcp` takes a bearer token (see
[MCP for Claude](#mcp-for-claude)). `/` is
open to a signed-out visitor, and shows the public home. A signed-out
visitor of each other page goes to `/login?next=<path>`. `/favicon.ico` returns 204: the crm has no icon.

## Passkeys and the admin

`/account/passkeys` lists the passkeys of the person (name, added, last
used), adds one with a name, and deletes one. A client can add a passkey,
but does not have to. The `session.method` column records how each session
started: `email`, `passkey` or `recovery`.

- **Admin routes.** A route with `config: { admin: true }` in its Fastify
  route options is an admin route. Only the person for `CRM_ADMIN_EMAIL`, in
  a `passkey` session, opens it. Each other session gets a 403 page at the
  same URL, with no redirect (`ui/AdminOnly.tsx`). The page tells the
  person why:
  - The admin with no passkey: "This page needs a passkey. Add one to this
    device." The page holds the add-passkey form.
  - The admin with a passkey, in an email session: "This page needs a
    passkey sign-in." The page holds the "Sign in with a passkey" key.
  - Each other person: the page is for the admin only.

  After the passkey step, the script opens the same URL again.
- **Passkey changes.** The admin adds or deletes a passkey only in a
  `passkey` session. The exception is the first passkey: while the admin
  has none, an email or recovery session can add one.
- **The first passkey opens the admin pages.** When a person adds their
  first passkey, the session becomes a `passkey` session
  (`upgradeSession` in `auth.ts`). The person does not sign out and sign in
  again. The WebAuthn registration with user verification proves the
  authenticator, and the session was already trusted to add the first
  passkey. The session gets a new token, and lasts 90 days from then.
- **Recovery.** On the box, run this in crm-be:

  ```bash
  bun run admin:recover <email>
  ```

  It deletes the passkeys of that person, revokes all their sessions, and
  prints an enrolment link to `/login/recover`. The link works one time,
  for 15 minutes. It starts a `recovery` session that opens only
  `/account/passkeys`, for 15 minutes. Its first passkey makes it a
  `passkey` session.
- **Audit.** `passkey_add`, `passkey_delete`, `recover`, `session_upgrade`
  (with the old method) and each `sign_in` (with its method, and the
  session it replaced) go to `audit_log`.

Where each part is:

- `crm-be/src/auth.ts`: the session check on each request, the cookie, the
  `next` check, the `Origin` check on a POST, the rate limits and the audit
  rows.
- `crm-be/src/email.ts`: the only module that sends email.
- `crm-be/src/passkeys.ts`: the WebAuthn relying party, the challenges (one
  use, 5 minutes) and the two ceremonies. `routes/account/passkeys.tsx` and
  `routes/api/passkeys/*.ts` are its routes. `crm-fe/src/passkeys.ts` is the
  browser part.
- `crm-be/src/admin-recover.ts`: `bun run admin:recover`, and
  `routes/login/recover.tsx` for its link.
- `crm-be/src/routes/login.tsx`, `routes/login/code.tsx`,
  `routes/login/verify.tsx`, `routes/logout.ts`,
  `routes/account/sessions.tsx`: one file for each URL.
- `crm-be/src/test-helpers.ts`: `testApp()`, `signIn()`, `signInAdmin()`
  and `addOrg()` for tests. In tests, the admin is `admin@example.com`.
  `mcpClient()` connects the MCP client of the SDK to the test app, and
  `callTool()` calls a tool. `injectFetch()` sends each request of the
  client to the app, with no network.
- `crm-be/src/test-authenticator.ts`: a software passkey for tests.

## MCP for Claude

Claude connects to the crm as an assistant: it reads the crm and changes
it. It works from the Claude apps (web, desktop and phone) and from Claude
Code, on a Pro or a Max plan, with no API billing. For an invite, Claude
uses its own Google Calendar connector in the same chat. The crm has no
calendar code. The design is in
[docs/001-guiding-design.md](docs/001-guiding-design.md#mcp-server).

The MCP URL is `https://crm.seanmizen.com/api/mcp` (`CRM_PUBLIC_URL` and
`/api/mcp`).

### Connect the Claude apps (OAuth)

1. In Claude, open Settings, then Connectors, then add a custom connector.
   Give it the name `crm` and the URL `https://crm.seanmizen.com/api/mcp`.
   Leave the OAuth client ID and secret empty.
2. Claude opens `/account/connections/authorize` on the crm. Sign in with
   a passkey, if necessary. The page shows the app (`Claude`) and the host
   that it returns to (`claude.ai`). Tap `Allow`.
3. `/account/connections` lists the connection as an app sign-in.

### Connect Claude Code (a token)

1. On `/account/connections`, type a name (for example `Claude Code on my
   laptop`) and tap `Add`. The page shows the token and the command one
   time. The crm keeps only the hash.
2. Run the command:

   ```bash
   claude mcp add --transport http crm https://crm.seanmizen.com/api/mcp --header "Authorization: Bearer <token>"
   ```

### The tools

Each tool names an organisation by its slug, and a contact or an activity
entry by its number in the organisation (REQ-CRM-ID-001).

| Tool | Does |
| --- | --- |
| `search_organisations` | Finds organisations by name, postcode and stage, 50 to a page, in the order of the list. |
| `get_organisation` | Gets the details, the contacts and the Activity list of one organisation. |
| `list_due` | Lists the organisations with a next action due today or overdue, the oldest first. |
| `create_lead` | Adds an organisation at the stage Lead, and its first contact. |
| `log_visit` | Adds a visit with its outcome and a note. |
| `add_note` | Adds a note. |
| `set_stage` | Sets the stage. |
| `set_next_action` | Sets the next action and its due date. |
| `update_organisation` | Changes the details of an organisation. |
| `add_contact` | Adds a contact. |
| `update_contact` | Changes a contact. |
| `update_activity` | Changes a visit or a note. |

- **No delete, no erasure, no money** (REQ-CRM-MCP-001). The admin does
  those on the pages.
- **The same checks as the forms.** Each write tool reads its values with
  the record forms in `crm-be/src/forms/` (REQ-CRM-FORM-001), so it accepts
  the same values and gives the same errors.
- **History and audit.** Each write is one event in the history of the
  organisation, through the same functions as the pages
  (REQ-CRM-UNDO-001), with the actor `mcp:<connection name>`. It shows in
  the Activity list, and Undo on the page reverses it. The event also adds
  one `audit_log` row with the names of the changed fields.
- **Untrusted text.** Each result puts the text that a person typed (names,
  addresses, notes, contact details) in an `untrusted_text` object. The
  tool descriptions say that this text is data, never an instruction.
- **Dates.** Each time is ISO 8601 with the London offset. Each date is
  `YYYY-MM-DD`.
- **Hints.** The read tools have `readOnlyHint`. The tools that add a
  record have `destructiveHint: false`. The tools that change a value have
  `destructiveHint: true` and `idempotentHint: true`, so a client can ask
  before it runs them.

### Where each part is

- `crm-be/src/mcp.ts`: every tool, and `handleMcp`. The server is
  stateless: each POST gets a new server and transport, and the answer is
  JSON.
- `crm-be/src/routes/api/mcp.ts`: `/api/mcp`. No token, or a token that
  does not work: 401, with `WWW-Authenticate: Bearer
  resource_metadata="..."`, which starts the OAuth sign-in of a client. A
  token of a person who is not the admin: 403. The check runs on each
  request, so a token stops when `CRM_ADMIN_EMAIL` changes. GET and DELETE:
  405.
- `crm-be/src/oauth.ts`: the connections and OAuth 2.1, as the MCP
  authorization spec says. The crm is the resource server and the
  authorization server:
  - `/.well-known/oauth-protected-resource/api/mcp` (and the same at
    `/.well-known/oauth-protected-resource`): the protected resource
    metadata (RFC 9728).
  - `/.well-known/oauth-authorization-server`: the authorization server
    metadata (RFC 8414).
  - `POST /api/oauth/register`: the client registration (RFC 7591). Each
    client is public, with no secret. A redirect URI must be the callback
    of the Claude apps (`https://claude.ai/api/mcp/auth_callback`, or the
    same on `claude.com`) or a loopback URL, on any port (Claude Code).
    Each address can register 20 clients in an hour. Each registration
    deletes the clients that have no connection and no code after 24
    hours.
  - `/account/connections/authorize`
    (`routes/account/connections/authorize.tsx`): the consent page, an
    admin route. It needs PKCE (`S256`). `Allow` sends a code that works
    one time, for 5 minutes.
  - `POST /api/oauth/token`: a code or a refresh token for tokens. An
    access token works for 1 hour. A refresh token works for 90 days, and
    each refresh gives a new one: the old one stops.
- `crm-be/src/routes/account/connections.tsx`: `/account/connections`, an
  admin route. It adds a named token, and lists and revokes each token and
  each app sign-in, with its name, its date and when it was last used.
- `crm-be/migrations/006-connections.sql`: `oauth_client`, `oauth_code` and
  `connection`. The database keeps only the SHA-256 hash of each token,
  code and refresh token. `audit_log` gets `connection_add` and
  `connection_revoke`.

## Env vars

| Name | Default | Read by | What it does |
| --- | --- | --- | --- |
| `PORT` | `4100` | `index.ts`, `scripts/shoot.mjs` | The port crm-be listens on. The screenshot script uses `4110` when it is unset. |
| `DB_PATH` | `crm-be/data/crm.db` | `db.ts` | The SQLite file. Git ignores the default folder. |
| `NODE_ENV` | unset | `auth.ts`, `email.ts` | `production` adds `Secure` to the session cookie. The prod compose service sets it. `test` puts emails into `devOutbox` in place of stdout. |
| `LOG_LEVEL` | `info` | `index.ts` | The lowest level that crm-be writes: `error`, `warn`, `info` or `debug`. One line for each request is at `debug`. Each other value stops crm-be at boot. |
| `CRM_ADMIN_EMAIL` | unset | `index.ts`, `auth.ts` | The admin email. At boot, crm-be makes this person if it is missing. Only this person opens the admin routes. Unset: crm-be makes nobody, only existing people can sign in, and nobody opens the admin routes. |
| `CRM_PUBLIC_URL` | `http://localhost:4100` | `auth.ts`, `demo.ts` | The prod compose service sets `https://crm.seanmizen.com`, and the demo service sets `https://demo-crm.seanmizen.com`. The start of the links in the sign-in email and from `admin:recover`. Its host is the WebAuthn relying party ID, and its origin is the expected WebAuthn origin. A passkey works only on this host. The links never use the request `Host` header. |
| `CRM_UNSAFE_DEMO_LOGIN` | unset | `demo.ts` | `true` turns on the demo: the `Enter as admin (demo)` button, the demo line on each page, and `Reset demo data`. Unset or `false`: off. Each other value stops crm-be at boot. See [Demo](#demo). |
| `SMTP_HOST` | `smtp.gmail.com` | `email.ts` | The SMTP server. |
| `SMTP_PORT` | `587` | `email.ts` | The SMTP port. `465` uses TLS from the start. Each other port uses STARTTLS. |
| `SMTP_USER` | unset | `email.ts` | The SMTP user and the sender address: `9mazes@gmail.com`. Necessary when `SMTP_PASS` has a value. |
| `SMTP_PASS` | unset | `email.ts` | The Gmail app password of `SMTP_USER`. Unset: dev mode. Each email goes to stdout, and crm-be sends nothing. |
| `EMAIL_FROM_NAME` | `seanmizen.com Administrator` | `email.ts` | The display name of the sender. The From header is `"<EMAIL_FROM_NAME>" <SMTP_USER>`. |
| `CRM_R2_BUCKET` | unset | `docker-compose.yml` (`litestream`), `litestream.yml` | The R2 bucket of the backups: `crm`. Unset: the Litestream sidecar prints "Replication is off." and stops. Nothing goes to R2. |
| `CRM_R2_ENDPOINT` | unset | `docker-compose.yml` (`litestream`), `litestream.yml` | The EU endpoint of R2: `https://8e76a7e41317a164bf03bf360ba4ac38.eu.r2.cloudflarestorage.com`. When `CRM_R2_BUCKET` has a value, each other endpoint stops the sidecar with status 1. |
| `LITESTREAM_ACCESS_KEY_ID` | unset | Litestream | The access key ID of the R2 API token for the bucket `crm`. |
| `LITESTREAM_SECRET_ACCESS_KEY` | unset | Litestream | The secret access key of the same token. |
| `CRM_R2_PATH` | unset | `docker-compose.yml` (each Litestream sidecar), `litestream.yml` | The prefix of the backup files in the bucket. The compose file sets it: `crm.db` for prod, `demo-crm.db` for the demo. Unset: the sidecar stops with status 1. |

When `SMTP_PASS` has a value and `SMTP_USER` has none, crm-be stops at boot.
crm-be does not wait for the send. When a send fails, crm-be logs the SMTP
error code and status, with no secret, and the response does not change.

- **dev:** `docker-compose.yml` passes the `CRM_*`, `SMTP_*` and `EMAIL_FROM_NAME` values through
  from the host.
- **prod:** `docker-compose.yml` sets `NODE_ENV=production`,
  `CRM_PUBLIC_URL=https://crm.seanmizen.com` and `DB_PATH=/data/crm.db`. Each
  other value comes from `apps/crm/.env` on the server. The file is not in
  the repo, and `deploy.sh` never changes it. Without the file, each value
  is unset.

## Production

The crm is live at `crm.seanmizen.com` on the web box (asus).

- **Deploy.** `yarn workspace crm prod:docker` builds the `prod` image and
  starts the `prod` profile. The image builds crm-fe with Rsbuild one time,
  and Bun runs crm-be with no watch. After each release, `deploy.sh` runs
  the root `yarn prod:docker`, which runs this script.
- **Routes.** The DNS record is in `infra/cloudflare/seanmizen_com.tf`. The
  tunnel sends `crm.seanmizen.com` to `localhost:4100`
  (`apps/cloudflared/config.yml`). The port is on `127.0.0.1` only. The crm
  is not on the LAN edge (`infra/edge`), because sign-in needs HTTPS and the
  origin `https://crm.seanmizen.com`.
- **Data.** The SQLite file is `/data/crm.db` in the named volume
  `crm_sqlite_data`. The volume is only on the web box.
- **Secrets.** `apps/crm/.env` on the server:

  ```bash
  CRM_ADMIN_EMAIL=
  SMTP_HOST=
  SMTP_PORT=
  SMTP_USER=
  SMTP_PASS=
  CRM_R2_BUCKET=crm
  CRM_R2_ENDPOINT=https://8e76a7e41317a164bf03bf360ba4ac38.eu.r2.cloudflarestorage.com
  LITESTREAM_ACCESS_KEY_ID=
  LITESTREAM_SECRET_ACCESS_KEY=
  ```

  Copy the four `SMTP_*` lines from `apps/carolinemizen.art/caroline-be/.env`
  on asus. caroline-be and inside-be send with the same Gmail
  account, `9mazes@gmail.com`. The `SMTP_PASS` app password gives full access
  to the `9mazes@gmail.com` mailbox. The account is a sender-only account:
  keep no other mail in it. With no `SMTP_PASS`, each sign-in email goes to
  the log (`docker logs crm`).
- **Recovery.** `bun run admin:recover <email>` runs in the container:

  ```bash
  ssh -t srv@asus docker exec -it crm bun run admin:recover <email>
  ```

## Backups

The `litestream` service in the `prod` profile (`litestream.yml`) streams
`/data/crm.db` to R2. It keeps a snapshot each day, and keeps each file for
90 days. Then erased data expires from the backups.

- **Bucket:** `crm`, with the prefix `crm.db/`. The demo uses the prefix
  `demo-crm.db/` in the same bucket. `infra/cloudflare/r2.tf` defines the
  bucket. A test (`crm-be/src/demo.test.ts`) fails when two sidecars have
  the same prefix.
- **Jurisdiction:** EU. The data stays inside the EU. Cloudflare has no UK
  jurisdiction. UK GDPR allows a transfer to the EEA under the UK adequacy
  regulations.
- **Endpoint:**
  `https://8e76a7e41317a164bf03bf360ba4ac38.eu.r2.cloudflarestorage.com`.
  The default R2 endpoint cannot reach an EU bucket.
- **Status:** `docker logs crm-litestream`.

To restore, run these commands on the web box. The restore replaces
`/data/crm.db` with the latest copy from R2.

```bash
ssh srv@asus
cd ~/projects/seanorepo/apps/crm
docker compose --profile prod stop crm litestream
# Show the restore plan. This changes nothing.
docker compose --profile prod run --rm --no-deps --entrypoint litestream litestream restore -dry-run /data/crm.db
# Replace the database and its -wal and -shm files.
docker compose --profile prod run --rm --no-deps --entrypoint litestream litestream restore -force /data/crm.db
yarn workspace crm prod:docker
```

To restore to an earlier time, add `-timestamp 2026-11-03T12:00:00Z` to the
restore command.

## Demo

The demo is at `demo-crm.seanmizen.com`. It shows the crm to a client, with
dummy data and an unsafe sign-in. It runs the same code as the live site:
both build from the `release` checkout on asus, and both change on
`yarn release`. The demo never shows work that is not released.

- **Same image, other env.** The `crm-demo` service in `docker-compose.yml`
  uses the same image and settings as `crm`. Only these are different: the
  volume `crm_demo_sqlite_data`, the env file `apps/crm/.env.demo`, the host
  port 4101 and `CRM_PUBLIC_URL=https://demo-crm.seanmizen.com`. Its
  sidecar `litestream-demo` backs up to the bucket `crm` with the prefix
  `demo-crm.db/`.
- **Off without the file.** `scripts/prod-docker.sh` (the
  `prod:docker` script) adds the compose profile `demo` only when
  `apps/crm/.env.demo` exists. Without the file, it prints "The demo is
  off.", the demo does not start, and prod does not change.
- **Routes.** `infra/cloudflare/seanmizen_com.tf` has the DNS record. The
  tunnel sends `demo-crm.seanmizen.com` to `localhost:4101`
  (`apps/cloudflared/config.yml`).
- **Email is off.** `.env.demo` has no `SMTP_*` lines, so each sign-in email
  goes to the log (`docker logs crm-demo`). The demo never emails an
  address.

### The env file

`apps/crm/.env.demo` on asus:

```bash
CRM_R2_BUCKET=crm
CRM_R2_ENDPOINT=https://8e76a7e41317a164bf03bf360ba4ac38.eu.r2.cloudflarestorage.com
LITESTREAM_ACCESS_KEY_ID=
LITESTREAM_SECRET_ACCESS_KEY=
CRM_ADMIN_EMAIL=demo@example.com
CRM_UNSAFE_DEMO_LOGIN=true
```

The R2 lines are the same as in `apps/crm/.env`. This command makes the
file from `apps/crm/.env`. It shows no secret, and only the owner can read
the file:

```bash
ssh srv@asus
cd ~/projects/seanorepo/apps/crm
(umask 077 && { grep -E '^(CRM_R2_BUCKET|CRM_R2_ENDPOINT|LITESTREAM_ACCESS_KEY_ID|LITESTREAM_SECRET_ACCESS_KEY)=' .env; printf '%s\n' CRM_ADMIN_EMAIL=demo@example.com CRM_UNSAFE_DEMO_LOGIN=true; } > .env.demo) && cut -d= -f1 .env.demo
```

The last part prints the six names, with no values.

### The unsafe sign-in

`CRM_UNSAFE_DEMO_LOGIN=true` turns on three things (`crm-be/src/demo.ts`):

1. `/login` has the `Enter as admin (demo)` button
   (`routes/login/demo.tsx`). It starts a session for the person of
   `CRM_ADMIN_EMAIL`, as if by passkey, with no check. The admin pages
   open. `audit_log` gets `sign_in` with the method `demo`.
2. Each page shows this line at the top: "Demo. Anyone can sign in as the
   admin. Do not enter real data."
3. `/account` has the `Reset demo data` button
   (`routes/account/reset-demo.ts`). It runs the demo seed.

Unset means off: no `Enter as admin (demo)` button, no line, `Reset demo
data` is off, and `POST /login/demo` and `POST /account/reset-demo`
return 404. The guards:

- crm-be stops at boot when the switch is `true` and the host of
  `CRM_PUBLIC_URL` is `crm.seanmizen.com`. The live site cannot run with the
  switch on.
- crm-be stops at boot when the switch is `true` and `CRM_ADMIN_EMAIL` is
  unset, or when the switch has a value that is not `true` or `false`.
- The seed refuses to run when the host of `CRM_PUBLIC_URL` is
  `crm.seanmizen.com`.

### The seed

```bash
bun run demo:seed                                  # in crm-be
ssh -t srv@asus docker exec crm-demo bun run demo:seed
```

The seed (`crm-be/src/demo-seed.ts`) replaces all data with a fixed,
fictional set: 10 organisations, with contacts, visits, notes and stage
changes. The dates are relative to today, so some next actions are overdue,
one is due today, and some are in the future. The seed writes through the
same functions as the routes, so the Activity list of each organisation has
its rows, and each contact and activity entry gets its number from the same
counter. It keeps the person of `CRM_ADMIN_EMAIL`, with their sessions and
passkeys, and deletes each other person. Two runs give the same data.

Each name is fictional. Each email is at `example.com`, each phone number is
`07700 900xxx` (Ofcom keeps these numbers for drama), and each postcode
starts with `ZZ`.

### Sean's steps

1. Make `apps/crm/.env.demo` on asus with the command in
   [The env file](#the-env-file). The code before the release ignores the
   file.
2. Run `yarn release`. The "Infra apply" workflow makes the DNS record
   `demo-crm.seanmizen.com`. On asus, `deploy.sh` starts `crm-demo` and
   `litestream-demo`, and restarts cloudflared for the new route. Watch it:

   ```bash
   ssh srv@asus journalctl -u custom-release-poll.service -u custom-deploy.service -f
   ```

3. Put the demo data in the demo:

   ```bash
   ssh -t srv@asus docker exec crm-demo bun run demo:seed
   ```

4. Smoke test. Open `https://demo-crm.seanmizen.com`, read the demo line,
   tap `Enter as admin (demo)`, and open an organisation. Then open
   `https://crm.seanmizen.com/login`, and check that it has no demo line and
   no demo button. `ssh srv@asus docker logs crm-demo-litestream`
   shows the replication to `demo-crm.db/`.
5. Add the import block of the record to `infra/cloudflare/imports.tf` in a
   new PR. The ID is in
   `./tofu state show cloudflare_dns_record.seanmizen_com_demo_crm_cname`.

To restore the demo database from R2, run these commands on asus:

```bash
cd ~/projects/seanorepo/apps/crm
docker compose --profile demo stop crm-demo litestream-demo
docker compose --profile demo run --rm --no-deps --entrypoint litestream litestream-demo restore -dry-run /data/crm.db
docker compose --profile demo run --rm --no-deps --entrypoint litestream litestream-demo restore -force /data/crm.db
yarn workspace crm prod:docker
```
