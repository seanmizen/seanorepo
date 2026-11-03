# crm

A homebrew CRM for a solo developer who sells software services door to door.
It keeps contacts, visits, the pipeline and the GDPR records. Stripe keeps the
billing. After sign-in, the seller has these pages:

- `/` and `/orgs`: one list of every organisation (one handler). The LCD
  is a menu: name, stage, next action date and last activity. The LED of a
  row, in the bezel at its right, is lit when the next action is due. Each
  row links to `/orgs/<slug>`. The
  default order puts the due and overdue ones first (the oldest first),
  then the rest by last activity (the newest first). Three sort keys
  (`Last activity`, `Date added`, `Name`) sort ascending (green LED), then
  descending (red LED), then remove the sort. A search field (name or
  postcode) and the stage keys filter it. The URL holds all of it:
  `?q=&stage=&sort=&dir=&page=`. 50 rows to a page, with a pager in the
  footer. With JavaScript, the search, the stage keys, the sort keys and
  the pager update the list in place, and the focus stays where it was
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

  The boxes: **Activity** (every event, newest first, in a `<details>`
  that is closed until a tap), **Contacts** (each with `Edit` and
  `Remove`) and **Details** (with `Edit`). Each visit and note in Activity
  shows its number, for example `Visit 17: Spoke.`.
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
  `/account/passkeys` and `/account/sessions`. In the demo, also the
  `Reset demo data` button (see [Demo](#demo)).

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
- `crm-be/src/activity.ts` holds the visits and the notes, and
  `listEvents`: the Activity list of an organisation. It joins the visits,
  the notes and the `audit_log` rows of the organisation, its contacts and
  its activity. `crm-be/src/contacts.ts` holds the contacts: add, change and
  remove.
- Each write to an organisation, a person, a membership, a visit or a note
  adds an `audit_log` row. The actor is the id of the signed-in person. The
  row keeps ids, stages, dates and the names of the changed fields. It
  never keeps personal data or the text of a note: the Activity list gets
  the names from the current tables. A contact that is not in the crm now
  shows as "a removed contact".
- `crm-be/src/ui/` holds the parts that pages share: `SiteNav`, `Footer`,
  `Device`, `Lcd`, `Module`, `Key` (and `Keys`, a row of keys), `LatchKey`,
  `Field`, `RecordForm`, `Box`, `RecordTable`, `When`, `Led` and `Label`.
  `ui/Passkey.tsx` holds the two passkey controls (add a passkey, sign in
  with a passkey), and `ui/AdminOnly.tsx` holds the 403 page of an admin
  route.
- `crm-fe` holds only what the browser runs: `src/theme.css`, `src/main.ts`,
  `src/swap.ts` and `src/passkeys.ts`. It has no React. Rsbuild builds them to
  `crm-fe/dist` with hashed names and a manifest. Only the pages with a
  passkey control load the `passkeys` entry: `/login`, `/account/passkeys`
  and the 403 page of an admin route.
- `shared` holds the API types.

`yarn workspace crm start` builds crm-fe once. Then Rsbuild builds crm-fe in
watch mode and Bun runs crm-be in watch mode. `yarn workspace crm-be test`
also builds crm-fe first, because the test of `/` reads the manifest.

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
3. **Device** (`device`). The core function of the page, as one instrument:
   a `Device` with the `Lcd` at the top, then each `Module` on a grid of 6
   columns. The LCD shows data, or a menu: a list of records, each row a
   link. Nothing else in the LCD is interactive, and it never holds the page
   title, help text or a form control. A form error shows in the LCD, after
   the status mark. A module has its silkscreen label at the top left, its
   value at the top right, and its keys and fields below.
4. **Help and boxes** (`help` and `boxes`). The help is plain text. The
   data of the page is a stack of boxes (`ui/Box`): each box is white, with
   a silkscreen title, then tables, lists and definition lists in the page
   font. A box can hold links, keys and forms. On a narrow screen, each
   table row is a block of lines.
5. **Footer** (`ui/Footer.tsx`, text). The pager of a long list (`pager`),
   `privacy` and `top`. Each page has it, signed in or not.

The layout has one breakpoint, 960px (REQ-CRM-LAYOUT-001, in
`crm-fe/src/theme.css`):

- **Wide (960px and more):** a grid of two columns, 40% and 60%. The device
  is the left column. The help and the boxes are the right column. The page
  is at most 1200px wide and starts at the top left. The nav links move to
  the footer row, next to `top`.
- **Narrow (less than 960px):** one column: nav, device, help, boxes,
  footer. The page margin is 1px, so the device and the boxes use almost
  all of the width.

The root font is 14px wide and 17px narrow, so no column width uses `rem`:
the columns are fractions.

The LCD follows the rules of a real display (REQ-CRM-LCD-001, in
`ui/Lcd.tsx`). No LED is inside the glass: a status there is the status
mark, an ink circle that blinks slowly. The characters never move: each
menu row has an arrow column at its left, and a hover shows the arrow
there. The menu rows have one height, and the LED of a row is in the bezel
at its right, so the LEDs are a straight column.

To see each page, run the screenshot script from the repo root. It starts
crm-be on port 4110 with a new SQLite file in a temp folder, and puts sample
data and an admin passkey session in it. It touches no other database. It
shoots each page at the breakpoint minus 1px, the breakpoint, the
breakpoint plus 24px, 390px, 1200px and 1440px, in light and dark mode, and
prints each page that scrolls sideways.

```bash
node apps/crm/scripts/shoot.mjs [out-dir]
```

To test the list in place (`crm-fe/src/swap.ts`) in a browser, run the
swap test from the repo root. It starts crm-be on port 4127 with a new
SQLite file, as the screenshot script does. In Chromium, it types `sw11` in
the search field and presses Enter. Then it checks the URL, the rows, the
focus and the caret, and that the page did not load again. It does the
same for a stage key and a sort key. Then it does the search again with
JavaScript off.

```bash
node apps/crm/scripts/swap-test.mjs
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
  never a React component in the browser. A GET form or a link with
  `data-swap="<selector list>"` updates the page in place
  (`crm-fe/src/swap.ts`, on every page). The script fetches the URL that
  the browser would load. It replaces each element that matches the
  selector list with the element from the response. Then it puts the URL in
  the address bar, and keeps the focus and the caret. On an error it loads
  the full page. A swap never replaces the field that a person types in:
  on the list, `LIST_SWAP` in `routes/index.tsx` names each swapped part.
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
`/account/sessions` lists the sessions, with a "Revoke" key for each one
except this session. When there is another session, its "Sign out" module
has the key "Everywhere else", which revokes all other sessions. The nav of
each page has "sign out" for this session. Each page except the sign-in
pages, `/privacy`, `/api/health` and `/favicon.ico` needs a session. `/` is
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
- `crm-be/src/test-authenticator.ts`: a software passkey for tests.

## Env vars

| Name | Default | Read by | What it does |
| --- | --- | --- | --- |
| `PORT` | `4100` | `index.ts`, `scripts/shoot.mjs` | The port crm-be listens on. The screenshot script uses `4110` when it is unset. |
| `DB_PATH` | `crm-be/data/crm.db` | `db.ts` | The SQLite file. Git ignores the default folder. |
| `NODE_ENV` | unset | `auth.ts`, `email.ts` | `production` adds `Secure` to the session cookie. The prod compose service sets it. `test` puts emails into `devOutbox` in place of stdout. |
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
  on asus. tcp-getter, caroline-be and inside-be send with the same Gmail
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

Unset means off: no button, no line, and `POST /login/demo` and
`POST /account/reset-demo` return 404. The guards:

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
