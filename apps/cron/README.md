# cron

Scheduled jobs on the home server, and the data for the dashboard at
[seanmizen.com/cron](https://seanmizen.com/cron).

One Bun process runs each job in `src/registry.ts` on its cron schedule, with
[croner](https://github.com/Hexagon/croner). It writes each run to SQLite, and
serves `GET /api/cron` on port 4001. The tunnel sends `seanmizen.com/api/*`
to this port. The dashboard is a page of seanmizen.com. It only reads, and it
asks for new data every 30 seconds.

The schedule is in London time (`Europe/London`). Croner skips a tick while
the last run of the same job has not finished.

## Add a job

1. Write a file in `src/jobs/`. It exports a `Job` (see `src/job.ts`).
2. Add the job to the list in `src/registry.ts`. The list order is the page
   order.
3. Run `yarn workspace cron test`. A test checks each expression and each id.
4. Merge, then release. The deploy builds the new image.

```ts
import type { Job } from '../job';

export const example: Job = {
  id: 'example', // stable: the runs and the saved value use it
  title: 'Example',
  description: 'One sentence for the dashboard.',
  schedule: '30 7 * * 1-5', // 07:30, Monday to Friday
  run: async (ctx) => {
    const last = ctx.load<number>(); // the value from the last run
    ctx.save((last ?? 0) + 1);
    return { summary: 'One line for the dashboard.' };
  },
};
```

To remove a job, remove its line from `src/registry.ts`. Its old runs stay in
the database for 30 days, and the page does not show them.

## What a run gives back

| Field | Use |
|---|---|
| `status` | `ok` (the default), `notice` (something to see), or `alert` (something is wrong). A run that throws is an `error`. |
| `summary` | One line. The page shows it beside the run. |
| `detail` | Optional text, for example a diff. The page shows the detail of the last run that is not `ok`. The service keeps at most 64 KB. |

The context gives a job three functions:

- `ctx.load()` and `ctx.save(value)`: one JSON value for each job, kept
  between runs.
- `ctx.email(subject, text)`: sends to `CRON_EMAIL_TO`. It returns `sent`,
  `off` (no SMTP settings: the email went to the log) or `failed`. It never
  throws. Put the result in the summary, so that the page shows it.

The service keeps the runs for 30 days. The API gives the last 48 runs of each job.

## The jobs

| Job | Schedule | What it does |
|---|---|---|
| `obell-uptime` | `*/5 * * * *` | Fetches obell.dev. Sends one email when the site goes down, and one when it comes back. A down is an HTTP status that is not 2xx, a network error, or no answer in 15 s. |
| `obell-snapshot` | `0 * * * *` | Fetches obell.dev, and compares it with the last snapshot. A change is a `notice`, and its detail is a unified diff. |

## Run it

```bash
yarn cron     # the service on http://localhost:4001
yarn sean     # seanmizen.com. Its dev server sends /api to 4001.
```

Then open http://localhost:4000/cron (the port that `yarn sean` prints).
`yarn workspace cron test` runs the tests.

## Env

| Variable | Default | Reader | Use |
|---|---|---|---|
| `PORT` | `4001` | `index.ts` | The HTTP port. |
| `DB_PATH` | `./data/cron.db` | `index.ts` | The SQLite file. The image sets `/data/cron.db`, in the volume `cron_data`. |
| `LOG_LEVEL` | `info` | `log.ts` | `error`, `warn`, `info` or `debug`. Each other value stops the service at startup. An `ok` run logs at `debug`, a `notice` at `info`, an `alert` at `warn`, and an `error` at `error`. |
| `SMTP_PASS` | unset | `email.ts` | The Gmail app password of `SMTP_USER`. Unset: email is off, and each email goes to the log. |
| `SMTP_USER` | unset | `email.ts` | The SMTP user and the sender address. Necessary when `SMTP_PASS` has a value. |
| `SMTP_HOST` | `smtp.gmail.com` | `email.ts` | The SMTP server. |
| `SMTP_PORT` | `587` | `email.ts` | `465` uses TLS from the start. Each other port uses STARTTLS. |
| `EMAIL_FROM_NAME` | `seanmizen.com cron` | `email.ts` | The display name of the sender. |
| `CRON_EMAIL_TO` | unset | `email.ts` | The address that gets each email. Necessary when `SMTP_PASS` has a value. |

When `SMTP_PASS` has a value and `SMTP_USER` or `CRON_EMAIL_TO` has none, the
service stops at startup.

In prod, the values come from `/etc/seanorepo/cron.env` (REQ-SERVER-021).
The debbie README, "Server secrets", has the row. The `SMTP_*` lines are the
same as in `/etc/seanorepo/caroline.env`.

## The data is public

The page and `/api/cron` have no sign-in. Each summary and each detail is
public. A job must not put a secret or a private address in them.
