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
yarn demo:recall                      # a 3-day product recall: runs/recall.html
yarn qc playback demo                 # show what happened
ls runs/demo/world/brindlehart/bh-mf01/var/mail/
```

With models (needs `ANTHROPIC_API_KEY`, or Ollama for the `local` tier. See
[Run offline on one PC](#run-offline-on-one-pc)):

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
   `concurrency` limits the requests at the same time (unset: no limit).
   `timeout_s` sets the time for one request (default 1800 seconds).
2. **Actors** (`actors.yaml`): a model, its settings and its price. The
   providers `script`, `idle` and `external` are built in. `extra_body` adds
   fields to each `openai-compatible` request.
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
| cases (only on a host with `/srv/cases`) | `case_list`, `case_show`, `case_intake`, `case_open`, `case_assign`, `case_update`, `case_close` |

Workstation tools take `sudo: true`. It works only for the wheel group. Other
users get the classic refusal, and the attempt goes to `/var/log/auth.log`.

Three MCP servers, all on stdio:

- `qc mcp-worker <run> --seat <id>`: work as one seat from Claude Code or any
  MCP client. Cast that seat to the `external` actor. Each call runs at once
  against the next turn's snapshot, and goes to `pending/`. When the engine
  runs the turn, it replays the calls, so the journal holds the results that
  the agent saw.
- `qc mcp-cases <run> --seat <id>`: the case system only, as one seat. It
  works as `mcp-worker` does, with the case tools and the briefing.
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

## The case system

A case system is a business tool group (REQ-QC-026). Each case is a text
file on the host where the seat works: `/srv/cases/open/<id>.case`, or
`/srv/cases/closed/<id>.case` after `case_close`. A case file has a header
(id, status, subject, customer, assignee, opened, updated, number of
messages) and a log of the mail, notes, assignments and replies.

| Tool | What it does | Minutes |
|---|---|---|
| `case_list` | Counts and the oldest cases. Filter by status and assignee (`me`, `none`, a user). | 1 |
| `case_show` | One case. With no id, your oldest open case. | reading |
| `case_intake` | Make cases from the new mail of the intake mailbox. A message from a customer with an open case goes into that case. | 1, plus 1 for each 10 messages |
| `case_open` | Open a case by hand. | writing |
| `case_assign` | One case to one person, or the N oldest unassigned cases to a list of people, in turn. | 1, plus 1 for each 10 more cases |
| `case_update` | Add a note, a reply, or both. | writing |
| `case_close` | Close a case, with an optional reply. With no id, your oldest open case. | reading, plus writing |

The case system is a service on the host. It acts for a user who can write
`/srv/cases/open`, so the IT administrator gives access with the group of
that folder. The case tools appear only on a host that has `/srv/cases`.

`/srv/cases/config` names the intake mailbox, with the line
`intake: support`. That is a role mailbox: an account that takes mail, with
no person and no seat (REQ-QC-027). Declare it in the organisation file:

```yaml
groups: [support]
mailboxes: [support]          # support@<domain> takes mail
files:
  - { path: /srv/cases, dir: true, owner: root, group: support, mode: "770" }
  - { path: /srv/cases/open, dir: true, owner: root, group: support, mode: "770" }
  - { path: /srv/cases/closed, dir: true, owner: root, group: support, mode: "770" }
  - { path: /srv/cases/config, owner: root, group: support, mode: "640", content: "intake: support\n" }
```

A reply goes from the intake address, for example
`support@haldenhome.example`, with the name of the seat in the signature.
The sent copy is in the sent folder of the role mailbox. A reply from a
consultant also comes from the company's domain, so a population member
counts it as an answer. Two seats can change one case in the same turn. The
merge keeps the later seat's write (REQ-QC-008), so give each case to one
person.

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
                     groups, people, role mailboxes, seed files
providers.yaml       model services
actors.yaml          actors and tiers
casts/<name>.yaml    casts
scripts/*.yaml       tool calls for the script actor
```

A script file maps a seat id to turns, and a turn to tool calls. A key
`<from>..<to>` is a range: its calls run in each turn from `from` to `to`
(REQ-QC-028). A key that names one turn beats a range. When two ranges
include a turn, the later range wins. A top-level key that starts with `x-`
holds YAML anchors, for example a reply that many seats use.

```yaml
x-reply: &reply "Thank you. Your refund is on its way."
liam@haldenhome.example:
  fy1-q1-d1-t3..fy1-q1-d3-t32:
    - { tool: case_close, args: { resolution: refunded, reply: *reply } }
  fy1-q1-d1-t8:                  # this turn only
    - { tool: think_privately, args: { thought: "Same email forty times." } }
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

## Run offline on one PC

The `local` cast runs every seat on one open-weight model, on the same PC,
with no network. It is free and slow. Expect tens of seconds for each seat in
each turn, and some hours for one simulated day.

### The PC

| Part | Value |
|---|---|
| GPU | NVIDIA GTX 980 Ti: Maxwell, compute capability 5.2, 6 GB VRAM |
| CPU | Intel Core i7, 6th generation (Skylake), AVX2 |
| RAM | 32 GB |
| OS | Windows, with QuarterCompany and Ollama in WSL 2 (Ubuntu) |

### Server and model

**Server: Ollama 0.12 or later, installed in WSL.**

- Ollama supports NVIDIA compute capability 5.0 and later. Cards from 5.0 to
  6.2 need driver 570 or later.
- CUDA 13 removed Maxwell, Pascal and Volta. Ollama ships a CUDA 12 runner
  next to the CUDA 13 runner, and it selects the CUDA 12 runner for an older
  card. llama.cpp also still ships CUDA 12 builds.
- The NVIDIA 580 driver branch is the last branch for Maxwell. The 590 branch
  does not support the GTX 900 series. Keep the Windows driver on the 580
  branch. WSL uses the Windows driver, so do not install a Linux driver in
  WSL. `setup-local-pc.sh` prints a warning for a driver below 570 or from 590.
- Ollama gives an OpenAI-compatible API, loads one copy of a model for all
  requests, and queues the requests. vLLM needs compute capability 7.0 or
  later, so it does not run on this card.

**Model: `qwen3:8b` (Qwen3 8B, Q4_K_M, 5.2 GB), with thinking off.**

- Alibaba trained Qwen3 for native tool calls, and Ollama parses its tool calls
  into the OpenAI `tool_calls` field.
- `reasoning_effort: none` (in `actors.yaml`) stops the thinking. One step
  then uses tens of tokens, not hundreds. Remove the line to compare.
- Memory: the weights are 5.2 GB. An 8,192-token context adds about 1.2 GB
  of KV cache. That is more than 6 GB, so Ollama puts most layers on the GPU
  and the remainder on the CPU. `ollama ps` shows the split. The 32 GB of RAM
  holds the remainder with no problem.
- Other models that we did not choose:
  - `qwen3.5:9b` (6.6 GB) does not fit in 6 GB.
  - `qwen3:4b` (2.5 GB) and `qwen3.5:4b` (3.4 GB) fit completely on the GPU
    and run faster. Their tool calls are less reliable. Set
    `QC_LOCAL_MODEL=qwen3:4b` for the setup script, and change `model` in
    `actors.yaml`, to try one.
  - `llama3.1:8b` (4.9 GB) has the same memory problem as `qwen3:8b` and
    weaker tool calls.

**One model for every seat.** The `local` tier points to one actor, so every
seat uses the same model. Ollama keeps one loaded copy
(`OLLAMA_MAX_LOADED_MODELS=1`) and runs one request at a time
(`OLLAMA_NUM_PARALLEL=1`). The `ollama` provider has `concurrency: 1`, so
QuarterCompany sends one request at a time and each request waits for its
slot, not for the server (REQ-QC-033). A change of model between seats would
reload 5 GB each time, and that is too slow on this card.

**Fallbacks.** If CUDA does not work in WSL (`ollama ps` shows `100% CPU`):

1. Check that `nvidia-smi` works in WSL. If it does not, install the Windows
   driver from the 580 branch and run `wsl --shutdown`.
2. CPU only: Ollama uses the CPU when it finds no GPU. The Skylake CPU with
   AVX2 gives a few tokens each second. The run still works, more slowly.
3. llama.cpp `llama-server` with a CUDA 12 build, or a Vulkan build on
   Windows, with `--jinja` for tool calls and `-c 8192`. Point the `ollama`
   provider `base_url` to `http://127.0.0.1:8080/v1`. A server on the
   Windows side is reachable from WSL as 127.0.0.1 only with mirrored
   networking (`networkingMode=mirrored` in `.wslconfig`).

### Set up the PC (online, one time)

In WSL, with the network on:

```bash
git clone https://github.com/seanmizen/seanorepo && cd seanorepo
bash apps/QuarterCompany/scripts/setup-local-pc.sh
```

The script installs Ollama, sets the server environment, pulls `qwen3:8b`
(about 5.2 GB), runs `yarn install`, and sends one test request with a tool.

### Offline mode

`QC_OFFLINE=1` turns on offline mode (REQ-QC-030). Unset, it does nothing.
In offline mode, QuarterCompany checks the actor of each seat before the
seat works, and checks each model request. A provider host that is not
`localhost`, `127.x.x.x` or `::1` stops the run with an error, and the turn
is not written. The `anthropic` provider always stops an offline run.

### Prove it offline

```bash
cd projects/agentic-workflows
export QC_OFFLINE=1
# Turn off the network in Windows (airplane mode). Then this must fail:
curl -sS --max-time 5 https://example.com && echo "STOP: the network is on"
yarn qc new offline --scenario scenario --cast local --replace
time yarn qc run offline --days 1 2>&1 | tee offline-run.log
yarn qc cost offline --by turn
yarn qc cost offline --by role
yarn qc export offline            # writes runs/offline.html
```

The model-written variant pool (REQ-QC-024), on a copy of the scenario with
`model_mail` on. The staff follow the script, and only the population uses
the local model:

```bash
rm -rf /tmp/qc-pool && cp -r scenario /tmp/qc-pool
sed -i 's/^kind: population$/kind: population\nmodel_mail: true\npool_size: 3/' \
  /tmp/qc-pool/orgs/shop-customers.yaml
printf 'default: scripted\nrules:\n  - match: { org: shop-customers }\n    use: local\n' \
  > /tmp/qc-pool/casts/pool.yaml
yarn qc new pool --scenario /tmp/qc-pool --cast pool --replace
yarn qc run pool --until fy1-q1-d1-t6
yarn qc playback pool --from fy1-q1-d1-t6 | grep -e "mail pool" -e shop-customers
yarn qc cost pool --by role       # the "population" row is the pool call
```

### Bad tool calls

A small model sometimes writes a bad tool call. The `openai-compatible`
brain reads native `tool_calls` first. If a reply has none, it reads
`<tool_call>{"name": ..., "arguments": ...}</tool_call>` blocks from the
text. A call with arguments that are not a JSON object, with no tool name,
or with an unknown tool goes in the journal as a failed `tool.call` with 0
minutes. The model gets the error as the tool result, and the turn
continues (REQ-QC-031). The brain removes `<think>` blocks from the text.

### Time and tokens

Each `model.call` event has `ms`, the wall-clock time of the request
(REQ-QC-032). `qc run` prints the time of each turn. `qc cost --by turn`
shows the calls, tokens and request seconds of each turn. `--by role` shows
them for each role. A local actor has no price, so the cost is 0.

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
