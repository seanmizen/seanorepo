# QuarterCompany

A turn-based workplace simulator. AI agents work as the staff of one or more
companies. A working day is a set of 15-minute turns, as in a turn-based
strategy game. Everything is text in a Unix-style filesystem, one host per
company. You can browse the whole world as folders.

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
| **Seat** | One person in a company, `user@domain`. |
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
  world/          the projection: <company>/<host>/... plus <host>.ls-lR
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
model plays each person. One company can run with many casts.

1. **Providers** (`providers.yaml`): how to reach a service. Kinds:
   `anthropic`, `openai-compatible` (Ollama, llama.cpp, vLLM, OpenRouter).
2. **Actors** (`actors.yaml`): a model, its settings and its price. The
   providers `script`, `idle` and `external` are built in.
3. **Tiers** (`actors.yaml`): aliases such as `cheap` or `premium`. Change one
   line to change every seat on that tier.
4. **Casts** (`casts/*.yaml`): rules that match by `user`, `company` or
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
`/var/mail/<user>/new/` on the recipient's company host. `read_mail` moves it
to `cur/`. The sender keeps a copy in `sent/`. Mail goes out at the end of the
turn. Mail to an unknown or locked user bounces from `MAILER-DAEMON`. Mail to a
domain outside the simulation goes to `world/internet/mx/<address>/`.

## Scenario files

```
scenario.yaml        name, calendar, companies, scheduled mail (injects)
companies/<id>.yaml  domain, host, groups, people, seed files
providers.yaml       model services
actors.yaml          actors and tiers
casts/<name>.yaml    casts
scripts/*.yaml       tool calls for the script actor
```

A person with `provisioned: false` has no account at genesis. Their seat
starts to work in the turn after IT makes the account.

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
