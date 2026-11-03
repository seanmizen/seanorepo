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
  Fastify route and its page component. `crm-be/src/index.ts` registers them.
- `crm-be/src/render.tsx` holds `renderPage(title, children, request)`. It
  adds the doctype, the `<head>`, the asset tags from
  `crm-fe/dist/manifest.json`, and the panel layout (`ui/Page.tsx`).
- `crm-be/src/org.ts` holds the organisation: the stages, the visit outcomes,
  the slug maker and the London date. The page for `/<slug>` is
  `routes/[slug].tsx`, and its forms post to `routes/[slug]/*.ts`. The static
  routes win over `/<slug>`, and `RESERVED_SLUGS` keeps their first words out
  of the slugs.
- Each write to an organisation, a person, a membership, a visit or a note
  adds an `audit_log` row. The actor is the id of the signed-in person.
- `crm-be/src/ui/` holds the parts of the panel that pages share: `Panel`,
  `Key`, `Led`, `Field` and `Label`.
- `crm-fe` holds only what the browser runs: `src/theme.css` and
  `src/main.ts`. It has no React. Rsbuild builds them to `crm-fe/dist` with
  hashed names and a manifest.
- `shared` holds the API types.

`yarn workspace crm start` builds crm-fe once. Then Rsbuild builds crm-fe in
watch mode and Bun runs crm-be in watch mode. `yarn workspace crm-be test`
also builds crm-fe first, because the test of `/` reads the manifest.

## Theme

`crm-fe/src/theme.css` is the Pixel-3 theme of autosam: an instrument panel
with silkscreen labels, raised keys, LEDs and one red signal color. Dark mode
follows `prefers-color-scheme`. Add `?theme=bare` to a URL to see the page
with no page styles and no scripts.

## Page rules

- The browser runs no React.
- Every page works as raw HTML, with no CSS and no JavaScript
  (REQ-CRM-BARE-001).
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

A session is a random cookie (`crm_session`) that lasts 90 days.
`/account/sessions` lists the sessions, revokes one, or revokes all others,
and has the "Sign out" button. Each page except the sign-in pages and
`/api/health` needs a session. A signed-out visitor goes to
`/login?next=<path>`.

Where each part is:

- `crm-be/src/auth.ts`: the session check on each request, the cookie, the
  `next` check, the `Origin` check on a POST, the rate limits and the audit
  rows.
- `crm-be/src/email.ts`: the only module that sends email.
- `crm-be/src/routes/login.tsx`, `routes/login/code.tsx`,
  `routes/login/verify.tsx`, `routes/logout.ts`,
  `routes/account/sessions.tsx`: one file for each URL.
- `crm-be/src/test-helpers.ts`: `testApp()`, `signIn()` and `addOrg()` for tests.

## Env vars

| Name | Default | Read by | What it does |
| --- | --- | --- | --- |
| `PORT` | `4100` | `index.ts` | The port crm-be listens on. |
| `DB_PATH` | `crm-be/data/crm.db` | `db.ts` | The SQLite file. Git ignores the default folder. |
| `NODE_ENV` | unset | `auth.ts`, `email.ts` | `production` adds `Secure` to the session cookie. `test` puts emails into `devOutbox` in place of stdout. |
| `CRM_ADMIN_EMAIL` | unset | `index.ts` | The admin email. At boot, crm-be makes this person if it is missing. Unset: crm-be makes nobody, and only existing people can sign in. |
| `CRM_PUBLIC_URL` | `http://localhost:4100` | `routes/login.tsx` | The start of the link in the sign-in email. The link never uses the request `Host` header. |
| `EMAIL_API_KEY` | unset | `email.ts` | The email provider key. Unset: dev mode. Each email goes to stdout, and crm-be sends nothing. |
| `EMAIL_PROVIDER` | unset | `email.ts` | `resend` or `postmark`. Necessary when `EMAIL_API_KEY` has a value. |
| `EMAIL_FROM` | unset | `email.ts` | The sender address. Necessary when `EMAIL_API_KEY` has a value. |

When `EMAIL_API_KEY` has a value and `EMAIL_PROVIDER` or `EMAIL_FROM` is wrong,
crm-be stops at boot. `docker-compose.yml` passes the `CRM_*` and `EMAIL_*`
values through from the host.
