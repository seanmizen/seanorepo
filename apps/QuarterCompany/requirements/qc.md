# REQ-QC — QuarterCompany simulation core

QuarterCompany is a turn-based workplace simulator. AI agents work as staff
in one or more companies. All state is text in a Unix-style filesystem. Sean
set the core decisions in the session that made #534: the journal, no
permanent delete, mail in `/var/mail`, Unix RBAC run by an IT administrator,
the `fy1-q1-d1-t1` labels, and the words Playback and Retake.

---

## REQ-QC-001 — The journal is the only source of truth

- **Status:** active
- **Source:** sean
- **Origin:** #534
- **Type:** constraint
- **Priority:** P0
- **Statement:** The simulator shall build the world filesystem only by
  folding the journal events in order.
- **Rationale:** Sean wants each turn to be exactly replayable and
  inspectable. If any state lives outside the journal, a playback and the live
  run can disagree, and nobody notices until a video shows the wrong file. The
  `world/` folder and the git history are projections. They are useful to
  browse, but they are never read back as input.
- **Verification:** Test — `apps/QuarterCompany/test/engine.test.ts` › "the projection equals a fold of the journal"
- **Relations:** none

## REQ-QC-002 — Nothing is permanently deleted

- **Status:** active
- **Source:** sean
- **Origin:** #534
- **Type:** constraint
- **Priority:** P0
- **Statement:** The simulator shall keep every file version that any turn
  wrote, also after a seat removes the file.
- **Rationale:** A removal is an event, not a loss. File content lives in a
  content-addressed object store that only grows, and journal files are
  append-only. This also gives the IT administrator a real backup to restore
  from, which is an IT problem worth simulating.
- **Verification:**
  - Test — `apps/QuarterCompany/test/engine.test.ts` › "a removed file stays in the object store, and the admin can restore it"
  - Test — `apps/QuarterCompany/test/engine.test.ts` › "a journal file is never rewritten"
- **Relations:** none

## REQ-QC-003 — Turn labels are unpadded and sort by ordinal

- **Status:** active
- **Source:** sean
- **Origin:** #534
- **Type:** constraint
- **Priority:** P2
- **Statement:** The simulator shall label each turn as
  `fy{n}-q{n}-d{n}-t{n}` without zero padding.
- **Rationale:** A run can last far more than 1000 days, so any fixed padding
  width breaks. Code sorts turns by a numeric ordinal, never by label text.
- **Verification:** Test — `apps/QuarterCompany/test/time.test.ts` › "labels have no zero padding and round-trip through ord"
- **Relations:** none

## REQ-QC-004 — Access control is Unix accounts, groups and mode bits

- **Status:** active
- **Source:** sean
- **Origin:** #534
- **Type:** functional
- **Priority:** P1
- **Statement:** The simulator shall decide each file access from
  `/etc/passwd`, `/etc/group` and the file mode bits on the seat's host.
- **Rationale:** The IT administrator role manages access by changing real
  files with real tools, so a cheap model can get it wrong in realistic ways.
  Sudo outside the wheel group fails and goes to `/var/log/auth.log`.
- **Verification:**
  - Test — `apps/QuarterCompany/test/engine.test.ts` › "a user outside the group cannot read team files"
  - Test — `apps/QuarterCompany/test/engine.test.ts` › "sudo outside wheel is refused and logged, and sudo inside wheel works"
  - Test — `apps/QuarterCompany/test/engine.test.ts` › "a seat with no account does not work until IT makes the account"
- **Relations:** none

## REQ-QC-005 — Casts assign actors to seats, with the most specific rule

- **Status:** active
- **Source:** sean
- **Origin:** #534
- **Type:** functional
- **Priority:** P1
- **Statement:** The simulator shall resolve the actor for a seat from the
  cast rule with the highest specificity, and on a tie from the later rule.
- **Rationale:** Model choice has four layers: providers, actors, tiers and
  casts. Specificity is user, then company and role, then role, then company.
  A later rule wins a tie so that a recast during a run beats the cast file.
- **Verification:** Test — `apps/QuarterCompany/test/timeline.test.ts` › "the most specific rule wins"
- **Relations:** none

## REQ-QC-006 — A scenario never names a model

- **Status:** active
- **Source:** sean
- **Origin:** #534
- **Type:** constraint
- **Priority:** P2
- **Statement:** The scenario files shall define companies, people and seed
  files with no reference to a model, provider or actor.
- **Rationale:** One company must run with many casts, because comparing
  models on the same work is the point of the series. A persona belongs to the
  person, not to the model.
- **Verification:** Inspection — `apps/QuarterCompany/src/scenario.ts` has no model field in its schemas
- **Relations:** none

## REQ-QC-007 — Mail is delivered at the turn boundary

- **Status:** active
- **Source:** sean
- **Origin:** #534
- **Type:** functional
- **Priority:** P1
- **Statement:** When a turn ends, the simulator shall deliver each message
  sent in that turn to `/var/mail/<user>/new` on the recipient's company host.
- **Rationale:** Delivery at the boundary makes the result independent of
  which seat finished first. A message to an unknown or locked user bounces,
  and mail to a domain outside the simulation goes to the internet host.
- **Verification:**
  - Test — `apps/QuarterCompany/test/engine.test.ts` › "mail arrives at the end of the turn, between companies too"
  - Test — `apps/QuarterCompany/test/engine.test.ts` › "mail to an unknown or locked user bounces"
- **Relations:** amended-by REQ-QC-018

## REQ-QC-008 — Seats work on one snapshot and merge in seat-id order

- **Status:** active
- **Source:** agent:SEAN-534
- **Origin:** #534
- **Type:** constraint
- **Priority:** P0
- **Statement:** The simulator shall merge the changes of the seats in a turn
  in seat-id order, and record a change that no longer applies as an
  `fs.conflict` event.
- **Rationale:** Seats run at the same time against copies of one snapshot.
  If the merge used finish order, two runs with the same decisions could give
  different journals, and exact replay would fail. A tool that fails changes
  nothing, except the security log.
- **Verification:**
  - Test — `apps/QuarterCompany/test/engine.test.ts` › "seats merge in seat-id order, and a change that no longer applies is a conflict"
  - Test — `apps/QuarterCompany/test/engine.test.ts` › "the same decisions give the same journal"
  - Test — `apps/QuarterCompany/test/engine.test.ts` › "a failed tool changes nothing"
- **Relations:** depends-on REQ-QC-001

## REQ-QC-009 — Tools cost simulated minutes from a fixed turn budget

- **Status:** active
- **Source:** sean
- **Origin:** #534
- **Type:** functional
- **Priority:** P1
- **Statement:** If a tool needs more minutes than the seat has left in the
  turn, then the simulator shall refuse the tool.
- **Rationale:** Without a budget, a strong model does a week of work in one
  turn and the turn-based model fails. Reading and writing cost more for long
  text.
- **Verification:** Test — `apps/QuarterCompany/test/engine.test.ts` › "a tool that needs more minutes than are left is refused"
- **Relations:** none

## REQ-QC-010 — Each tool is defined once for every transport

- **Status:** active
- **Source:** sean
- **Origin:** #534
- **Type:** constraint
- **Priority:** P2
- **Statement:** The simulator shall expose the same tool definitions to
  model adapters and to MCP servers.
- **Rationale:** Some local models handle native function calls better than
  MCP. If each transport had its own tool code, an MCP agent and a model agent
  could see different worlds. An external MCP agent's calls are recorded and
  replayed by the engine, so the journal holds the results that the agent saw.
- **Verification:** Test — `apps/QuarterCompany/test/timeline.test.ts` › "the engine replays what the agent did, with the same results"
- **Relations:** none

## REQ-QC-011 — Playback never calls a model

- **Status:** active
- **Source:** sean
- **Origin:** #534
- **Type:** functional
- **Priority:** P1
- **Statement:** The playback command shall show past turns from the journal
  alone.
- **Rationale:** "Playback" means show what happened. "Retake" means ask the
  models again. Sean chose two different words so that no reader confuses a
  free operation with a paid one.
- **Verification:** Test — `apps/QuarterCompany/test/timeline.test.ts` › "playback reads the journal and shows each tool call"
- **Relations:** none

## REQ-QC-012 — A retake always makes a new timeline

- **Status:** active
- **Source:** sean
- **Origin:** #534
- **Type:** functional
- **Priority:** P1
- **Statement:** When a retake starts from a turn, the simulator shall make a
  new run folder and leave the original run unchanged.
- **Rationale:** Model output is not deterministic, so a retake is a fork, not
  a replay. The new run records its parent run and turn.
- **Verification:** Test — `apps/QuarterCompany/test/timeline.test.ts` › "retake makes a new run from a turn and leaves the original alone"
- **Relations:** none

## REQ-QC-013 — The simulator runs on Linux only

- **Status:** withdrawn
- **Source:** sean
- **Origin:** #534
- **Type:** constraint
- **Priority:** P1
- **Statement:** If the process platform is not Linux, then the qc command
  shall stop before it reads or writes a run.
- **Rationale:** Sean runs QuarterCompany in WSL. The first build used Bun,
  and the `bun` on the WSL path was the Windows `bun.exe`. It saw UNC paths
  and called Windows git, so the run folders and their git history were not
  reliable. QuarterCompany now runs on Node with `tsx`, and it refuses any
  platform other than Linux.
  Withdrawn in #538: Sean meant only that Windows is not supported. macOS and
  other Unix-like systems are fine, and Sean wants no platform guard. Nothing
  replaces this requirement.
- **Verification:** Inspection — `apps/QuarterCompany/src/cli.ts` (withdrawn: the check is removed)
- **Relations:** none

## REQ-QC-014 — Private thoughts never enter the world

- **Status:** active
- **Source:** sean
- **Origin:** #544
- **Type:** constraint
- **Priority:** P1
- **Statement:** The simulator shall keep each private thought out of the
  world filesystem, so that no tool in the simulation can read it.
- **Rationale:** Thoughts show the workers' personalities to the people who
  watch a run. They are out of universe: no person in the company can see
  them, the IT administrator included, with sudo or with restore. A thought is
  a journal event. The engine writes `minds/<seat>.md` beside `world/`, never
  inside it. The seat itself recalls its recent thoughts in its briefing.
- **Verification:**
  - Test — `apps/QuarterCompany/test/mind.test.ts` › "a thought never enters the world, and root cannot find it"
  - Test — `apps/QuarterCompany/test/mind.test.ts` › "the next briefing recalls the thought"
- **Relations:** depends-on REQ-QC-001

## REQ-QC-015 — Injected mail comes only from outside the simulation

- **Status:** superseded
- **Source:** sean
- **Origin:** #546
- **Type:** constraint
- **Priority:** P1
- **Statement:** If an injected mail has a sender address in the domain of a
  simulated company, then the simulator shall refuse the inject.
- **Rationale:** An inject in Priya's name was not in her sent folder, and she
  did not know about it. If Tom asked her about it, the world contradicted
  itself. Mail from a person inside the simulation must be that person's own
  action (REQ-QC-016). Mail from outside keeps a sent copy on the internet
  host.
- **Verification:** Test — `apps/QuarterCompany/test/compel.test.ts` › "an inject from a person in the simulation is refused"
- **Relations:** superseded-by REQ-QC-017

## REQ-QC-016 — A scenario makes a seat act through the seat's own session

- **Status:** active
- **Source:** sean
- **Origin:** #546
- **Type:** functional
- **Priority:** P1
- **Statement:** When a scenario or the director compels a seat to act in a
  turn, the simulator shall run those tool calls in that seat's own session,
  before its brain.
- **Rationale:** The world then records the action like any other: the
  journal marks the calls as compelled, they use the seat's minutes, and the
  results (a sent copy, a file) are real. The seat's briefing tells it what it
  did, so it can answer questions about it later. A compelled seat works even
  when it is asleep. A seat with no account cannot act, and the journal
  records `compel.skipped`.
- **Verification:**
  - Test — `apps/QuarterCompany/test/compel.test.ts` › "a compelled mail is the seat’s own: in its sent folder, and marked in the journal"
  - Test — `apps/QuarterCompany/test/compel.test.ts` › "the briefing tells the seat what it was made to do"
- **Relations:** depends-on REQ-QC-008

## REQ-QC-017 — Injects are system events, never people

- **Status:** active
- **Source:** sean
- **Origin:** #548
- **Type:** constraint
- **Priority:** P0
- **Statement:** The simulator shall accept as an inject only a system event
  on the host of an organisation in the world.
- **Rationale:** Sean: injects are system-wide and never simulate actors. A
  file system outage can be injected, but an external person cannot: that
  person is an actor in another organisation. Every sender is then a person
  with a mailbox and a sent folder, so the world never contradicts itself.
  The system events are `host.down`, `mail.down` and `disk.full`. To make a
  person act, a scenario uses compel (REQ-QC-016).
- **Verification:**
  - Test — `apps/QuarterCompany/test/compel.test.ts` › "an inject cannot carry mail: injects are system events only"
  - Test — `apps/QuarterCompany/test/system.test.ts` › "host.down: nobody logs in, mail to the host waits, then arrives"
- **Relations:** supersedes REQ-QC-015

## REQ-QC-018 — The world is closed: mail to an unknown domain bounces

- **Status:** active
- **Source:** sean
- **Origin:** #548
- **Type:** constraint
- **Priority:** P1
- **Statement:** If mail goes to a domain that no organisation in the world
  owns, then the simulator shall bounce it to the sender.
- **Rationale:** Nothing exists outside the world. A mail directory maps each
  domain to the host that holds its mailboxes. The old `internet/mx` host is
  gone. Customers, suppliers and consumers are organisations, so mail to them
  needs a real mailbox.
- **Verification:** Test — `apps/QuarterCompany/test/compel.test.ts` › "mail to a domain outside the world bounces"
- **Relations:** amends REQ-QC-007

## REQ-QC-019 — Blocked mail waits in a queue that the journal holds

- **Status:** active
- **Source:** agent:SEAN-548
- **Origin:** #548
- **Type:** functional
- **Priority:** P1
- **Statement:** While a system event blocks the sender host or the
  recipient host, the simulator shall hold the mail in a queue, and deliver it
  at the start of the first turn when nothing blocks it.
- **Rationale:** An outage must delay mail, not lose it. The queue is state:
  `mail.queued` and `mail.dequeued` events build it, so playback and the fold
  of the journal agree with the live run.
- **Verification:**
  - Test — `apps/QuarterCompany/test/system.test.ts` › "mail.down: people work, but their outgoing mail waits"
  - Test — `apps/QuarterCompany/test/system.test.ts` › "the fold of the journal gives the same world, queue included"
- **Relations:** depends-on REQ-QC-001

## REQ-QC-020 — The people in the world are world state

- **Status:** active
- **Source:** sean
- **Origin:** #550
- **Type:** functional
- **Priority:** P1
- **Statement:** The simulator shall build the set of people in the world
  only by folding the `person.join` and `person.leave` events in the journal.
- **Rationale:** A company must react inside the simulation, for example
  hire through an agency. The scenario seeds its people as `person.join`
  events at genesis. During a run, a person joins only through an action of
  another person: the staff of an `agency` or a `consultancy` use
  `place_person` and `end_placement`, directly or through compel. A new person
  has a seat, but cannot work until IT makes an account on the host where the
  person works. A second join of the same person in one turn is a conflict
  (REQ-QC-008). Casts match a new person by org and role, as for any person.
  A generated population needs no scenario entry for each person, because the
  journal holds each person in full.
- **Verification:**
  - Test — `apps/QuarterCompany/test/people.test.ts` › "the scenario seeds the people at genesis, as person.join events"
  - Test — `apps/QuarterCompany/test/people.test.ts` › "an agency places a new employee, who works only after IT makes the account"
  - Test — `apps/QuarterCompany/test/people.test.ts` › "casts resolve for new people by org and role"
  - Test — `apps/QuarterCompany/test/people.test.ts` › "a second join of the same person in one turn is a conflict"
  - Test — `apps/QuarterCompany/test/people.test.ts` › "a person whose placement ends stops working, and a compel for them is skipped"
  - Test — `apps/QuarterCompany/test/people.test.ts` › "the fold of the journal equals the live state, people included"
- **Relations:**
  - depends-on REQ-QC-001
  - depends-on REQ-QC-017

## REQ-QC-021 — A consultant has a mailbox at the employer and works at the client

- **Status:** active
- **Source:** sean
- **Origin:** #550
- **Type:** functional
- **Priority:** P2
- **Statement:** When a consultancy places a consultant at a client, the
  simulator shall keep the consultant's mailbox on the consultancy's host,
  and run the consultant's other tools on the client's host.
- **Rationale:** A consultant belongs to their own organisation. Their
  address is in the consultancy's domain, so the mail directory delivers
  their mail to the consultancy's host. The consultancy makes that account at
  once, because it is the employer. The client's IT administrator must still
  make an account on the client's host before the consultant can work.
- **Verification:** Test — `apps/QuarterCompany/test/people.test.ts` › "a consultant belongs to the consultancy: mail on its host, work on the client host"
- **Relations:** depends-on REQ-QC-020
