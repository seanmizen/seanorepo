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
- **Relations:** none

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

- **Status:** active
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
- **Relations:** none

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
