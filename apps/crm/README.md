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
yarn workspace crm prod:docker     # the prod image and Litestream (see Production)
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
  `Key`, `Led`, `Field` and `Label`. `ui/Passkey.tsx` holds the two passkey
  controls (add a passkey, sign in with a passkey), and `ui/AdminOnly.tsx`
  holds the 403 page of an admin route.
- `crm-fe` holds only what the browser runs: `src/theme.css`, `src/main.ts`
  and `src/passkeys.ts`. It has no React. Rsbuild builds them to
  `crm-fe/dist` with hashed names and a manifest. Only the pages with a
  passkey control load the `passkeys` entry: `/login`, `/account/passkeys`
  and the 403 page of an admin route.
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

4. `/login` also has "Sign in with a passkey". It needs JavaScript. A
   passkey sign-in replaces the current session, if there is one: crm-be
   deletes its row.

A session is a random cookie (`crm_session`) that lasts 90 days.
`/account/sessions` lists the sessions, revokes one, or revokes all others,
and has the "Sign out" button. Each page except the sign-in pages,
`/api/health` and `/favicon.ico` needs a session. A signed-out visitor goes
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
| `PORT` | `4100` | `index.ts` | The port crm-be listens on. |
| `DB_PATH` | `crm-be/data/crm.db` | `db.ts` | The SQLite file. Git ignores the default folder. |
| `NODE_ENV` | unset | `auth.ts`, `email.ts` | `production` adds `Secure` to the session cookie. The prod compose service sets it. `test` puts emails into `devOutbox` in place of stdout. |
| `CRM_ADMIN_EMAIL` | unset | `index.ts`, `auth.ts` | The admin email. At boot, crm-be makes this person if it is missing. Only this person opens the admin routes. Unset: crm-be makes nobody, only existing people can sign in, and nobody opens the admin routes. |
| `CRM_PUBLIC_URL` | `http://localhost:4100` | `auth.ts` | The prod compose service sets `https://crm.seanmizen.com`. The start of the links in the sign-in email and from `admin:recover`. Its host is the WebAuthn relying party ID, and its origin is the expected WebAuthn origin. A passkey works only on this host. The links never use the request `Host` header. |
| `EMAIL_API_KEY` | unset | `email.ts` | The email provider key. Unset: dev mode. Each email goes to stdout, and crm-be sends nothing. |
| `EMAIL_PROVIDER` | unset | `email.ts` | `resend` or `postmark`. Necessary when `EMAIL_API_KEY` has a value. |
| `EMAIL_FROM` | unset | `email.ts` | The sender address. Necessary when `EMAIL_API_KEY` has a value. |
| `CRM_R2_BUCKET` | unset | `docker-compose.yml` (`litestream`), `litestream.yml` | The R2 bucket of the backups: `crm`. Unset: the Litestream sidecar prints "Replication is off." and stops. Nothing goes to R2. |
| `CRM_R2_ENDPOINT` | unset | `docker-compose.yml` (`litestream`), `litestream.yml` | The EU endpoint of R2: `https://8e76a7e41317a164bf03bf360ba4ac38.eu.r2.cloudflarestorage.com`. When `CRM_R2_BUCKET` has a value, each other endpoint stops the sidecar with status 1. |
| `LITESTREAM_ACCESS_KEY_ID` | unset | Litestream | The access key ID of the R2 API token for the bucket `crm`. |
| `LITESTREAM_SECRET_ACCESS_KEY` | unset | Litestream | The secret access key of the same token. |

When `EMAIL_API_KEY` has a value and `EMAIL_PROVIDER` or `EMAIL_FROM` is wrong,
crm-be stops at boot.

- **dev:** `docker-compose.yml` passes the `CRM_*` and `EMAIL_*` values through
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
  EMAIL_API_KEY=
  EMAIL_PROVIDER=
  EMAIL_FROM=
  CRM_R2_BUCKET=crm
  CRM_R2_ENDPOINT=https://8e76a7e41317a164bf03bf360ba4ac38.eu.r2.cloudflarestorage.com
  LITESTREAM_ACCESS_KEY_ID=
  LITESTREAM_SECRET_ACCESS_KEY=
  ```

  With no email key, each sign-in email goes to the log (`docker logs crm`).
- **Recovery.** `bun run admin:recover <email>` runs in the container:

  ```bash
  ssh -t srv@asus.local docker exec -it crm bun run admin:recover <email>
  ```

## Backups

The `litestream` service in the `prod` profile (`litestream.yml`) streams
`/data/crm.db` to R2. It keeps a snapshot each day, and keeps each file for
90 days. Then erased data expires from the backups.

- **Bucket:** `crm`, with the prefix `crm.db/`. `infra/cloudflare/r2.tf`
  defines it.
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
ssh srv@asus.local
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
