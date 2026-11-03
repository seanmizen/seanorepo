# crm

A homebrew CRM for a solo developer who sells software services door to door.
It keeps contacts, visits, the pipeline and the GDPR records. Stripe keeps the
billing. After sign-in, the seller has these pages:

- `/` (Today): the organisations with a next action due today or earlier,
  oldest first, and the "New lead" key.
- `/orgs`: all organisations. A GET form searches the name and the postcode,
  and filters by stage. The URL holds the search.
- `/orgs/new`: add an organisation and its contact. The slug comes from the
  name.
- `/<slug>`: one organisation. It shows the details, the contacts, the visits
  and the notes, newest first. Its forms log a visit, change the stage and
  the next action, and add a note.
- `/account`: the person and the session, with links to
  `/account/passkeys` and `/account/sessions`.

`GET /api/health` returns `{ "ok": true }`. The design is in
[docs/001-guiding-design.md](docs/001-guiding-design.md).

```bash
yarn workspace crm start           # http://localhost:4100
yarn workspace crm start:docker    # the same, in a dev container
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
- `crm-be/src/org.ts` holds the organisation: the stages, the visit outcomes
  and the slug maker. The page for `/<slug>` is
  `routes/[slug].tsx`, and its forms post to `routes/[slug]/*.ts`. The static
  routes win over `/<slug>`, and `RESERVED_SLUGS` keeps their first words out
  of the slugs.
- Each write to an organisation, a person, a membership, a visit or a note
  adds an `audit_log` row. The actor is the id of the signed-in person.
- `crm-be/src/ui/` holds the parts that pages share: `SiteNav`, `Footer`,
  `Device`, `Lcd`, `Module`, `Key` (and `Keys`, a row of keys), `LatchKey`,
  `Field`, `Records` (and `RecordTable`), `When`, `Led` and `Label`.
  `ui/Passkey.tsx` holds the two passkey controls (add a passkey, sign in
  with a passkey), and `ui/AdminOnly.tsx` holds the 403 page of an admin
  route.
- `crm-fe` holds only what the browser runs: `src/theme.css`, `src/main.ts`
  and `src/passkeys.ts`. It has no React. Rsbuild builds them to
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
   the first element in `<body>`. Under it, for a signed-in person, one line
   of links: `today · orgs · new lead · account · sign out`. The link to this
   page is text, with `aria-current="page"`.
2. **Intro** (`intro`, text). At most one sentence.
3. **Device** (`device`). The core function of the page, as one instrument:
   a `Device` with the `Lcd` at the top, then each `Module` on a grid of 6
   columns. The LCD shows data, or a menu: a list of records, each row a
   link. Nothing else in the LCD is interactive, and it never holds the page
   title, help text or a form control. A form error shows in the LCD, with a
   lit LED. A module has its silkscreen label at the top left, its value at
   the top right, and its keys and fields below. Help text goes under the
   device (`help`), as plain text.
4. **Records** (`records`, text). History and reference data, as `Records`:
   tables, lists and definition lists in the page font, with no panel. On a
   phone, each table row is a block of lines.
5. **Footer** (`ui/Footer.tsx`, text). `top`, the pager of a long list
   (`pager`), and the theme and mode steppers.

On a wide screen the page starts at the top left. The device is a column of
about 360px, and the records fill the space to its right. On a phone it is
one column: nav, device, records, footer.

To see each page, run the screenshot script from the repo root. It starts
crm-be on port 4110 with a new SQLite file in a temp folder, and puts sample
data and an admin passkey session in it. It touches no other database.

```bash
node apps/crm/scripts/shoot.mjs [out-dir]
```

## Theme

`crm-fe/src/theme.css` is the Pixel-3 theme of autosam: an instrument panel
with silkscreen labels, raised keys, LEDs and one red signal color. Text
links use the ink color with an underline.

- **Theme.** Add `?theme=bare` to a URL to see the page with no page styles
  and no scripts. The theme stepper in the footer links this URL in the
  other theme.
- **Mode.** Auto, light or dark. Auto follows `prefers-color-scheme`. The
  mode stepper in the footer sends `POST /mode`, which keeps the mode in the
  `crm_mode` cookie for one year and opens the page again. crm-be then puts
  `data-mode` on `<html>`. A signed-out visitor can use it too.
- **Dates.** A date shows as `2026-Nov-03`, and a date and time as
  `2026-Nov-03 13:31`, in London time. Each one is a `<time>` with the full
  ISO value in `datetime` and the full date and time with seconds in
  `title` (REQ-CRM-DATE-001). Words such as `2 days overdue` show next to
  the date, never in place of it.

## Page rules

- The browser runs no React.
- Every page works as raw HTML, with no CSS and no JavaScript
  (REQ-CRM-BARE-001). The one exception is the passkey controls: WebAuthn
  needs JavaScript. With no JavaScript, the page says so, and email sign-in
  still works.
- Biome fails on `dangerouslySetInnerHTML` under `apps/crm` (see the
  `overrides` in the root `biome.json`).

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
`/account/sessions` lists the sessions and revokes one. Its "Sign out"
module has two keys: "Everywhere else" revokes all other sessions, and
"This device" signs out. The nav of each page also has "sign out". Each
page except the sign-in pages, `/mode`, `/api/health` and `/favicon.ico`
needs a session. A signed-out visitor goes
to `/login?next=<path>`. `/favicon.ico` returns 204: the crm has no icon.

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
| `NODE_ENV` | unset | `auth.ts`, `email.ts` | `production` adds `Secure` to the session cookie. `test` puts emails into `devOutbox` in place of stdout. |
| `CRM_ADMIN_EMAIL` | unset | `index.ts`, `auth.ts` | The admin email. At boot, crm-be makes this person if it is missing. Only this person opens the admin routes. Unset: crm-be makes nobody, only existing people can sign in, and nobody opens the admin routes. |
| `CRM_PUBLIC_URL` | `http://localhost:4100` | `auth.ts` | The start of the links in the sign-in email and from `admin:recover`. Its host is the WebAuthn relying party ID, and its origin is the expected WebAuthn origin. A passkey works only on this host. The links never use the request `Host` header. |
| `EMAIL_API_KEY` | unset | `email.ts` | The email provider key. Unset: dev mode. Each email goes to stdout, and crm-be sends nothing. |
| `EMAIL_PROVIDER` | unset | `email.ts` | `resend` or `postmark`. Necessary when `EMAIL_API_KEY` has a value. |
| `EMAIL_FROM` | unset | `email.ts` | The sender address. Necessary when `EMAIL_API_KEY` has a value. |

When `EMAIL_API_KEY` has a value and `EMAIL_PROVIDER` or `EMAIL_FROM` is wrong,
crm-be stops at boot. `docker-compose.yml` passes the `CRM_*` and `EMAIL_*`
values through from the host.
