# crm

A homebrew CRM for a solo developer who sells software services door to door.
It keeps contacts, visits, the pipeline and the GDPR records. Stripe keeps the
billing. The app is a skeleton. After sign-in, `GET /` shows a placeholder
page with the health result, and `GET /api/health` returns
`{ "ok": true }`. The design is in
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
- `crm-be/src/ui/` holds the parts of the panel that pages share: `Panel`,
  `Key`, `Led`, `Field` and `Label`.
- `crm-fe` holds only what the browser runs: `src/theme.css`, `src/main.ts`
  and `src/passkeys.ts`. It has no React. Rsbuild builds them to
  `crm-fe/dist` with hashed names and a manifest. Only `/login` and
  `/account/passkeys` load the `passkeys` entry.
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

4. `/login` also has "Sign in with a passkey". It needs JavaScript.

A session is a random cookie (`crm_session`) that lasts 90 days.
`/account/sessions` lists the sessions, revokes one, or revokes all others,
and has the "Sign out" button. Each page except the sign-in pages and
`/api/health` needs a session. A signed-out visitor goes to
`/login?next=<path>`.

## Passkeys and the admin

`/account/passkeys` lists the passkeys of the person (name, added, last
used), adds one with a name, and deletes one. A client can add a passkey,
but does not have to. The `session.method` column records how each session
started: `email`, `passkey` or `recovery`.

- **Admin routes.** A route with `config: { admin: true }` in its Fastify
  route options is an admin route. Only the person for `CRM_ADMIN_EMAIL`, in
  a `passkey` session, opens it. Each other session gets a 403 page. An
  email session of the admin goes to `/account/passkeys` while the admin
  has no passkey.
- **Passkey changes.** The admin adds or deletes a passkey only in a
  `passkey` session. The exception is the first passkey: while the admin
  has none, an email or recovery session can add one.
- **Recovery.** On the box, run this in crm-be:

  ```bash
  bun run admin:recover <email>
  ```

  It deletes the passkeys of that person, revokes all their sessions, and
  prints an enrolment link to `/login/recover`. The link works one time,
  for 15 minutes. It starts a `recovery` session that opens only
  `/account/passkeys`, for 15 minutes.
- **Audit.** `passkey_add`, `passkey_delete`, `recover` and each `sign_in`
  (with its method) go to `audit_log`.

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
- `crm-be/src/test-helpers.ts`: `testApp()`, `signIn()` and `signInAdmin()`
  for tests. In tests, the admin is `admin@example.com`.
- `crm-be/src/test-authenticator.ts`: a software passkey for tests.

## Env vars

| Name | Default | Read by | What it does |
| --- | --- | --- | --- |
| `PORT` | `4100` | `index.ts` | The port crm-be listens on. |
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
