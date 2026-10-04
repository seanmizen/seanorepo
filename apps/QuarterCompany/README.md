# QuarterCompany

A turn-based workplace simulator. AI agents work as the staff of one or more
companies. A working day is a set of 15-minute turns, as in a turn-based
strategy game. Everything is text in a Unix-style filesystem, one host per
organisation. You can browse the whole world as folders.

Requirements: [`requirements/qc.md`](requirements/qc.md).

## Platform

QuarterCompany runs on Node 20.19 or later, on Linux, macOS or another
Unix-like system. `tsx` compiles the TypeScript when the CLI starts, so there
is no build step. Windows is not supported: use WSL. Inside WSL, use the Linux
`node` and `git`, not a Windows binary on the path.

## Quick start

```bash
yarn                                  # from the repo root
cd projects/agentic-workflows
yarn demo                             # scripted day: no model, no cost
yarn qc playback demo                 # show what happened
ls runs/demo/world/brindlehart/bh-mf01/var/mail/
```

With models (needs `ANTHROPIC_API_KEY`, or Ollama for the `local` tier):

```bash
yarn qc new ep1 --scenario scenario --cast budget-it
yarn qc run ep1 --turns 8
yarn qc cost ep1 --by role
```

Runs go to `./runs`, or to `$QC_RUNS`.

## Seeing a run

```bash
yarn qc export demo            # writes runs/demo.html
```

The file is one self-contained page. Open it in any browser, with no server.
It steps through the turns with Prev, Next, Play and a slider. The arrow
keys also work. Quiet turns are hidden until you tick "Show quiet turns".
For each turn it shows:

- the staff: working, asleep or no account, minutes used, and the last note
- the turn log, with a clock time for each tool call
- the disk at the end of the turn, with new and changed files marked

Click a file, or "open" on a mail line, to read it. The page builds the disk
from the journal in the browser, so it always agrees with the engine. A link
that ends in `#fy1-q1-d1-t4` opens at that turn. `--fragment` writes the page
without the html, head and body tags, for a host page that wraps it.

## Words

| Word | Meaning |
|---|---|
| **Turn** | One slot of the working day. Labels look like `fy1-q1-d1-t1`, with no padding. `fy1-q1-d1-t0` is genesis. |
| **Seat** | One person in an organisation, `user@domain`. |
| **Actor** | A named model with its settings and price. |
| **Cast** | The rules that give each seat an actor. |
| **Playback** | Show turns that happened, from the journal. It never calls a model. |
| **Retake** | Go back to a turn and ask the models again. It always makes a new run. |

## How a turn works

1. The engine journals the director's recasts and delivers injected mail.
2. Every active seat works on its own copy of the same snapshot, at the same
   time. A seat is active when it has an account that is not locked, and is
   not asleep. A seat that ends with `wake: on_mail` sleeps until new mail
   comes, or until the next morning. A sleeping seat costs nothing.
3. The engine merges the seats' changes in seat-id order. A change that no
   longer applies becomes an `fs.conflict` event.
4. The mail system delivers the turn's mail.
5. The engine writes the journal, updates `world/`, and makes one git commit
   with the tag `t/<turn>`.

Each tool costs simulated minutes. A turn has 15. Reading and writing long
text costs more. A seat remembers nothing between turns except its
`end_turn` note and its files.

## A run folder

```
runs/<run>/
  run.json        cast, parent timeline, scheduled injects
  scenario/       copy of the scenario at creation time
  journal/        fy1/q1/d1/t1.jsonl ...   the truth, append-only
  objects/        content-addressed store: file versions and model payloads
  world/          the projection: <org>/<host>/... plus <host>.ls-lR
  pending/        calls from external agents, waiting for their turn
  minds/          private thoughts per seat (derived, out of universe)
  .git            one commit and one tag per turn
```

The engine derives `world/` from the journal. `qc materialize <run> --at <turn> --out <dir>` builds the
world at any turn from the journal alone. `git checkout t/<turn>` shows the
same thing.

A removal never destroys content. The object store only grows, and the IT
administrator can `restore` a removed file.

## Models: four layers

The scenario says who exists. It never names a model. The cast says which
model plays each person. One scenario can run with many casts.

1. **Providers** (`providers.yaml`): how to reach a service. Kinds:
   `anthropic`, `openai-compatible` (Ollama, llama.cpp, vLLM, OpenRouter).
2. **Actors** (`actors.yaml`): a model, its settings and its price. The
   providers `script`, `idle` and `external` are built in.
3. **Tiers** (`actors.yaml`): aliases such as `cheap` or `premium`. Change one
   line to change every seat on that tier.
4. **Casts** (`casts/*.yaml`): rules that match by `user`, `org` or
   `role`, with optional `from` and `until` turns. The most specific rule
   wins. On a tie, the later rule wins.

```yaml
default: standard
rules:
  - match: { role: it-admin }
    use: cheap
  - match: { role: it-admin }
    use: premium
    from: fy1-q1-d3-t10        # promote IT on day 3
```

`qc recast` adds a rule during a run. The next turn writes it to the journal.
`qc retake --cast` starts a new timeline with another cast.

## Tools and MCP

Each tool has one definition, in `src/tools/`. The model adapters and the MCP
servers use the same definitions.

| Group | Tools |
|---|---|
| mind | `think_privately` |
| workstation | `whoami`, `ls`, `read_file`, `write_file`, `append_file`, `mkdir`, `mv`, `rm`, `chmod`, `end_turn` |
| mail | `list_mail`, `read_mail`, `send_mail` |
| admin (wheel only) | `useradd`, `usermod`, `groupadd`, `chown`, `restore` |
| staffing (agency and consultancy staff only) | `place_person`, `end_placement` |

Workstation tools take `sudo: true`. It works only for the wheel group. Other
users get the classic refusal, and the attempt goes to `/var/log/auth.log`.

Two MCP servers, both on stdio:

- `qc mcp-worker <run> --seat <id>`: work as one seat from Claude Code or any
  MCP client. Cast that seat to the `external` actor. Each call runs at once
  against the next turn's snapshot, and goes to `pending/`. When the engine
  runs the turn, it replays the calls, so the journal holds the results that
  the agent saw.
- `qc mcp-director <run>`: run turns, play back, read the world, inject mail,
  recast, retake, and show cost.

Example `.mcp.json` entry:

```json
{
  "mcpServers": {
    "qc-director": {
      "command": "node",
      "args": ["apps/QuarterCompany/bin/qc.js", "mcp-director", "ep1"],
      "env": { "QC_RUNS": "projects/agentic-workflows/runs" }
    }
  }
}
```

## Private thoughts

`think_privately` keeps a thought that no person in the simulation can read,
the IT administrator included (REQ-QC-014). A thought is a journal event, not
a file in the world. It costs no minutes. The engine writes each seat's
thoughts to `runs/<run>/minds/<seat>.md`, beside `world/`. A seat's briefing
repeats its last 5 thoughts, so a seat remembers what it felt. The viewer shows
thoughts in their own colour, and each staff card shows the latest one.

## Mail

A message is an RFC 822-style `.eml` text file. Delivery puts it in
`/var/mail/<user>/new/` on the host of the recipient's organisation. `read_mail` moves it
to `cur/`. The sender keeps a copy in `sent/`. Mail goes out at the end of the
turn. Mail to an unknown or locked user bounces from `MAILER-DAEMON`, and so
does mail to a domain that no organisation owns. A system event can make mail
wait in the queue.

## Scenario files

```
scenario.yaml        name, calendar, orgs, compel (people act), injects (system events)
orgs/<id>.yaml       kind (company, agency, consultancy, provider,
                     population), domain, host,
                     groups, people, seed files
providers.yaml       model services
actors.yaml          actors and tiers
casts/<name>.yaml    casts
scripts/*.yaml       tool calls for the script actor
```

### A closed world: organisations, compel and inject

Every person belongs to an organisation in `orgs/<id>.yaml`. A customer or a
supplier is an organisation too, with its own host and mailboxes. A mail
directory maps each domain to its host. Mail to a domain that no organisation
owns bounces: nothing exists outside the world (REQ-QC-018).

A scenario changes the world in two ways only:

- **`compel`**: a person acts. At the given turn, the seat runs the given tool
  calls in its own session, before its brain, with its own minutes
  (REQ-QC-016). A compelled mail is in the sender's `sent/` folder, and the
  seat's briefing says what it did.
- **`injects`**: system events, the physics of the world. They never act as a
  person (REQ-QC-017). Each acts on one organisation's host from `at`, and
  ends at the start of `until`:
  - `host.down`: nobody on the host can log in. Mail to and from it waits.
  - `mail.down`: people work, but mail to and from the host waits.
  - `disk.full`: writes on the host fail. Mail to it waits.

Waiting mail is in a queue that the journal holds. The queue delivers it at
the start of the first turn when nothing blocks it (REQ-QC-019).

```yaml
compel:
  - at: fy1-q1-d1-t3
    seat: graham@cartwright-stationers.example
    do:
      - tool: send_mail
        args: { to: maria@brindlehart.example, subject: "Quote request", body: "..." }
injects:
  - at: fy1-q1-d1-t9
    until: fy1-q1-d1-t11
    kind: mail.down
    org: brindlehart
    note: The mail server restarts for an upgrade.
```

During a run, `qc compel` and `qc inject` (or the director's MCP tools) add
the same things.

A person with `provisioned: false` has no account at genesis. Their seat
starts to work in the turn after IT makes the account.

### People who join during a run

The set of people is world state. The journal holds it as `person.join` and
`person.leave` events (REQ-QC-020). Genesis writes one `person.join` for each
person in the scenario. After genesis, a person joins only through the action
of another person.

An organisation has a `kind`: `company` (the default), `agency` or
`consultancy`. The staff of an agency or a consultancy get two tools:

- `place_person`: a new person joins at the end of the turn.
  - From an agency, the person is an employee of the client:
    `<user>@<client domain>`.
  - From a consultancy, the person is a consultant of the consultancy:
    `<user>@<consultancy domain>`. The consultancy makes the account and the
    mailbox on its own host at once. The consultant works on the client's
    host (REQ-QC-021).
- `end_placement`: the person leaves at the end of the turn. Their accounts
  stay, and the client's IT administrator must lock them.

In both cases, the new seat cannot work until the client's IT administrator
runs `useradd` on the client's host. Casts match a new person by `org` and
`role`, as for any other person. A scenario that wants a placement at a given
turn compels the recruiter to call `place_person`.

### Populations: consumers at scale

A `population` is a crowd of people, for example 5,000 owners of a kettle.
A `provider` is a consumer mail service, for example `postbox.example`. The
provider's host holds the mailboxes of the population's members, and the
mail directory maps the provider's domain to that host.

```yaml
# orgs/postbox.yaml
kind: provider
name: Postbox Mail
domain: postbox.example
host: pb01

# orgs/kettle-owners.yaml
kind: population
name: Kettle owners
provider: postbox
members:
  size: 5000
  seed: 7
  traits:
    - { key: owns, value: kettle-k2, share: 0.4 }
behaviour:
  - id: k2-fault
    from: fy1-q1-d2-t1
    who: { owns: kettle-k2 }
    p: 0.02                       # chance to write in, per member and turn
    write:
      to: support@brindlehart.example
      subject: ["My {owns} is faulty", "Problem with {owns}"]
      body: "Hello,\n\nMy {owns} switches off.\n\n{name}"
    chase: { after: 2d, subject: "Re: my {owns}", body: "No reply yet. {first}" }
    escalate: { after: 1d, to: priya@brindlehart.example, subject: Complaint, body: "..." }
```

- **Members** come from the seed: names, user names and traits. The
  journal holds the population as one `population.join` event, and the fold
  makes the same members from it (REQ-QC-022). Each member has an account on
  the provider's host. A mailbox appears with the first mail.
- **The bulk brain** runs once for each population in each turn
  (REQ-QC-023). From `from`, each member that matches `who` writes in with
  probability `p`. A member with no reply from the recipient's domain chases
  after `chase.after`, then escalates after `escalate.after`. A duration is
  turns (`4t`) or working days (`2d`). `population.step` events record the
  progress. The same seed gives the same journal. Each mail is the member's
  own `send_mail` call, in the member's own session, so it is in the
  member's sent folder.
- **Text** can have variants. For each member, the brain replaces
  `{first}`, `{last}`, `{name}`, `{address}` and each key of `who` (here
  `{owns}`).
- **Model-written mail** is off by default. With `model_mail: true`, a model
  writes `pool_size` variants of each step once, and the members use the
  pool (REQ-QC-024). The cast chooses the model, for example
  `match: { org: kettle-owners }`. The pool goes in the object store, and a
  `population.pool` event records its hash, so a playback and a retake use
  the same pool. A local `openai-compatible` provider such as Ollama works.
- **Scale**: a turn with 5,000 members and about 500 mails runs in about
  1.5 seconds (REQ-QC-025). A filesystem view is a copy-on-write layer, so
  no seat or tool call copies the whole world.
- **Playback and the viewer** show one row for each population and turn,
  for example "312 mails from Kettle owners". Open the row to read each
  mail.

The default calendar is 09:00 to 17:00 in 15-minute slots: 32 turns a day,
65 working days a quarter, and 4 quarters a year. Day 1 is a Monday. Weekends
are not simulated.

## Commands

Run `qc --help` for the full list. From the repo root, `yarn qc <command>`
works. From `projects/agentic-workflows`, `yarn qc <command>` works.

## Tests

```bash
yarn workspace quarter-company test
yarn workspace quarter-company typecheck
```

The tests run on Vitest 3, which supports Node 20. They use a small fixture
scenario in `test/fixture/` and a fake model server. They make no paid model calls.
