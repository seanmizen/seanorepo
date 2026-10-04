// The turn engine. One turn:
//
//   1. Journal the director's recasts. Deliver injected mail.
//   2. Every active seat works on its own copy of the same snapshot, at the
//      same time. Each population works as one bulk session on its own
//      copy (REQ-QC-023).
//   3. Merge the seats' changes in seat-id order, then the populations' in
//      org-id order. A change that no longer applies becomes an fs.conflict
//      event.
//   4. Deliver the turn's mail.
//   5. Write the journal, update the projection, commit and tag.
//
// The order in step 3 does not depend on which seat finished first, so the
// journal is the same for the same decisions. See REQ-QC-008.
import { brainFor } from './brains/index.ts';
import { checkActorOffline, OfflineError } from './brains/net.ts';
import { type Casting, resolveCast } from './cast.ts';
import type { EventBody, JournalEvent } from './events.ts';
import { type Op, Ops } from './ops.ts';
import { type PopulationTurn, populationTurn } from './population.ts';
import { briefing, systemPrompt } from './prompt.ts';
import { type Run, type SimState, tagOf } from './run.ts';
import { type Compel, hostOf, type Seat, seatsIn } from './scenario.ts';
import { Session } from './session.ts';
import { describeTurn, GENESIS, isFirstSlotOfDay, labelOf } from './time.ts';
import { Directory } from './users.ts';
import type { Vfs } from './vfs.ts';
import { deliver, releaseQueue, seedWorld } from './world.ts';

export interface TurnReport {
  label: string;
  active: string[];
  skipped: string[];
  /** Mails that population members sent in the turn. */
  populationMails: number;
  events: number;
  costUsd: number;
  /** Wall-clock milliseconds of the turn. Not in the journal. See REQ-QC-032. */
  ms: number;
}

type Logger = (line: string) => void;

function stamp(
  events: { actor: string; body: EventBody }[],
  label: string,
  ord: number,
): JournalEvent[] {
  return events.map(
    (e, seq) =>
      ({ seq, turn: label, ord, actor: e.actor, ...e.body }) as JournalEvent,
  );
}

/** Write the genesis turn. A new run calls this once. */
export function genesis(run: Run): SimState {
  if (run.lastOrd() >= 0)
    throw new Error('This run has a genesis turn already.');
  const state = run.load();
  const ops = new Ops(state.vfs, run.objects, 0);
  ops.emit('engine', {
    type: 'turn.start',
    label: GENESIS,
    clock: describeTurn(GENESIS, run.scenario.calendar),
  });
  seedWorld(ops, run.scenario);
  ops.emit('engine', { type: 'turn.end', label: GENESIS });
  const events = stamp(ops.list, GENESIS, 0);
  for (const e of events)
    if (e.type === 'person.join') state.applyPerson(e, 0);
    else if (e.type === 'population.join') state.apply(e);
  state.ord = 0;
  run.writeTurn(GENESIS, events);
  run.project(state);
  run.commit(GENESIS, `genesis of ${run.scenario.name}`);
  return state;
}

/**
 * Unread mail that arrived at or after a turn. Mail from the end of the
 * seat's last active turn counts, because the seat has not seen it.
 */
export const unreadSince = (state: SimState, seat: Seat, sinceOrd: number) =>
  state.vfs
    .children(seat.mailHost, `/var/mail/${seat.person.user}/new`)
    .filter((k) => k.node.mtime >= sinceOrd).length;

const unreadIn = (vfs: Vfs, seat: Seat) =>
  vfs.children(seat.mailHost, `/var/mail/${seat.person.user}/new`).length;

export interface CompelledCall {
  tool: string;
  args: Record<string, unknown>;
  source: 'scenario' | 'director';
}

/** The calls that the scenario and the director compel a seat to make in a turn. */
export function compelledFor(
  run: Run,
  label: string,
  seat: string,
): CompelledCall[] {
  const pick = (list: Compel[], source: CompelledCall['source']) =>
    list
      .filter((c) => c.at === label && c.seat === seat)
      .flatMap((c) => c.do.map((d) => ({ ...d, source })));
  return [
    ...pick(run.scenario.compel, 'scenario'),
    ...pick(run.info.compel ?? [], 'director'),
  ];
}

/**
 * Run compelled calls in the seat's own session, before its brain. They use
 * the seat's minutes and appear in the journal as its tool calls, marked as
 * compelled. Returns one line per call, for the briefing. See REQ-QC-016.
 */
export async function runCompelled(
  session: Session,
  calls: CompelledCall[],
): Promise<string[]> {
  const did: string[] = [];
  for (const c of calls) {
    const r = await session.call(c.tool, c.args, { compelled: c.source });
    did.push(describeCall(c.tool, c.args, r.ok ? undefined : r.text));
  }
  return did;
}

function describeCall(
  tool: string,
  args: Record<string, unknown>,
  error?: string,
): string {
  const list = (v: unknown) =>
    Array.isArray(v) ? v.join(', ') : String(v ?? '');
  const what =
    tool === 'send_mail'
      ? `You sent mail to ${list(args.to)}${args.cc ? ` (cc ${list(args.cc)})` : ''}: "${args.subject ?? ''}"`
      : `You ran ${tool} ${JSON.stringify(args)}`;
  return error ? `${what}. It failed: ${error}` : `${what}.`;
}

async function pool<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
) {
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i]);
      }
    },
  );
  await Promise.all(workers);
}

/**
 * Events at the start of a turn, before any seat works: the director's
 * recasts, then system events (ends before starts), then the release of
 * queued mail that nothing blocks now. System and queue events change `state`
 * at once, as the fold does. The qc-worker server runs the same step on a
 * copy, so an external agent sees the same snapshot as the engine.
 */
export function turnStart(run: Run, state: SimState, ops: Ops, label: string) {
  for (const rule of run.info.pendingCastRules ?? [])
    ops.emit('director', { type: 'cast.rule', rule });
  const events = [
    ...run.scenario.injects.map((i) => ({ ...i, source: 'scenario' as const })),
    ...run.info.injects.map((i) => ({ ...i, source: 'director' as const })),
  ];
  const hostFor = (orgId: string) => {
    const org = run.scenario.orgs.find((o) => o.id === orgId);
    if (!org)
      throw new Error(
        `A system event names organisation "${orgId}". The scenario has no such organisation.`,
      );
    return hostOf(org);
  };
  for (const e of events.filter((x) => x.until === label)) {
    const body = {
      type: 'system.end' as const,
      kind: e.kind,
      org: e.org,
      host: hostFor(e.org),
    };
    ops.emit(e.source, body);
    state.applyLive(body);
  }
  for (const e of events.filter((x) => x.at === label)) {
    const body = {
      type: 'system.start' as const,
      kind: e.kind,
      org: e.org,
      host: hostFor(e.org),
      note: e.note,
      source: e.source,
    };
    ops.emit(e.source, body);
    state.applyLive(body);
  }
  const mark = ops.list.length;
  releaseQueue(ops, run.scenario, [...state.queue], state.system);
  for (const op of ops.list.slice(mark)) state.applyLive(op.body);
}

export async function runTurn(
  run: Run,
  state: SimState,
  log: Logger = () => {},
): Promise<TurnReport> {
  const t0 = performance.now();
  const { scenario } = run;
  const cal = scenario.calendar;
  const ord = state.ord + 1;
  const label = labelOf(ord, cal);
  const clock = describeTurn(label, cal);
  const events: { actor: string; body: EventBody }[] = [];
  const main = new Ops(state.vfs, run.objects, ord, state.system);
  const drain = () => {
    events.push(...main.list);
    main.list = [];
  };

  main.emit('engine', { type: 'turn.start', label, clock });
  // 1. Recasts from the director, system events, queued mail.
  const pendingRules = run.info.pendingCastRules ?? [];
  turnStart(run, state, main, label);
  drain();
  const castRules = [...state.castRules];
  for (const e of events)
    if (e.body.type === 'cast.rule') castRules.push(e.body.rule as never);
  const cast = {
    ...run.castFile,
    rules: [...run.castFile.rules, ...castRules],
  };

  // 2. Decide who works, then let them work.
  const sessions: {
    seat: Seat;
    session: Session;
    casting: Casting;
    compelled: CompelledCall[];
  }[] = [];
  const skipped: string[] = [];
  const seats = seatsIn(scenario, state.people);
  // A compel for a person who is not in the world does not run. The person
  // can join later in the run, so the scenario cannot check this at load.
  const absent = [
    ...new Set(
      [...scenario.compel, ...(run.info.compel ?? [])]
        .filter((c) => c.at === label && !seats.some((x) => x.id === c.seat))
        .map((c) => c.seat),
    ),
  ].sort();
  for (const seat of absent)
    events.push({
      actor: 'engine',
      body: {
        type: 'compel.skipped',
        seat,
        reason: 'the person is not in the world',
      },
    });
  for (const seat of seats) {
    const dir = Directory.load(state.vfs, run.objects, seat.host);
    const compelled = compelledFor(run, label, seat.id);
    if (
      state.system.get(seat.host)?.has('host.down') &&
      dir.canLogin(seat.person.user)
    ) {
      const reason = `host ${(seat.site ?? seat.org).host} is down`;
      events.push({
        actor: 'engine',
        body: { type: 'seat.blocked', seat: seat.id, reason },
      });
      if (compelled.length)
        events.push({
          actor: 'engine',
          body: { type: 'compel.skipped', seat: seat.id, reason },
        });
      continue;
    }
    if (!dir.canLogin(seat.person.user)) {
      if (compelled.length) {
        events.push({
          actor: 'engine',
          body: {
            type: 'compel.skipped',
            seat: seat.id,
            reason: 'the seat has no account that can log in',
          },
        });
      }
      continue;
    }
    const casting = resolveCast(run.models, cast, seat, ord, cal);
    // A sleeping seat costs nothing. Scripts name their own turns, so they never sleep.
    const prev = state.seats.get(seat.id);
    const asleep =
      prev?.wake === 'on_mail' &&
      !isFirstSlotOfDay(label) &&
      unreadSince(state, seat, prev.lastActiveOrd) === 0;
    // A compelled seat works even when it is asleep.
    if (asleep && casting.actor.provider !== 'script' && !compelled.length) {
      events.push({
        actor: 'engine',
        body: { type: 'seat.skip', seat: seat.id, reason: 'asleep until mail' },
      });
      skipped.push(seat.id);
      continue;
    }
    sessions.push({
      seat,
      casting,
      compelled,
      session: new Session(
        seat,
        scenario,
        label,
        ord,
        state.vfs.clone(),
        run.objects,
        state.system,
        state.people,
      ),
    });
  }

  // Offline mode: stop before any seat works (REQ-QC-030).
  for (const s of sessions) checkActorOffline(run.models, s.casting.actor);

  let costUsd = 0;
  await pool(
    sessions,
    scenario.concurrency,
    async ({ seat, session, casting, compelled }) => {
      const did = await runCompelled(session, compelled);
      const brain = brainFor(
        casting.actor.provider,
        run.models.providers[casting.actor.provider]?.kind,
      );
      try {
        await brain({
          session,
          casting,
          models: run.models,
          runDir: run.dir,
          system: systemPrompt(seat, cal.slotMinutes, scenario.turnMinutes),
          briefing: briefing(
            session,
            state.seats.get(seat.id),
            unreadIn(session.vfs, seat),
            state.thoughts.get(seat.id),
            did,
          ),
          record: (c) => {
            costUsd += c.costUsd;
            session.ops.emit(seat.id, {
              type: 'model.call',
              seat: seat.id,
              actor: casting.actorName,
              model: c.model,
              inputTokens: c.inputTokens,
              outputTokens: c.outputTokens,
              costUsd: c.costUsd,
              ms: c.ms,
              request: run.objects.putJson(c.request),
              response: run.objects.putJson(c.response),
            });
          },
        });
      } catch (err) {
        // Offline mode stops the run (REQ-QC-030).
        if (err instanceof OfflineError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        session.ops.emit(seat.id, {
          type: 'model.error',
          seat: seat.id,
          actor: casting.actorName,
          message,
        });
        log(`  ${seat.id}: ${message}`);
      }
    },
  );

  // Populations: one bulk session each, on the same snapshot as the seats.
  const bulk: PopulationTurn[] = [];
  for (const pop of scenario.orgs
    .filter((o) => o.kind === 'population' && state.populations.has(o.id))
    .sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const t = await populationTurn(run, state, pop, label, ord, cast);
    costUsd += t.costUsd;
    bulk.push(t);
  }

  // 3. Merge in seat order, then the populations.
  const merge = (list: Op[], seatId?: string) => {
    for (const op of list) {
      const b = op.body;
      // A join or a leave changes the people at once, so a second join of
      // the same person in this turn is a conflict. See REQ-QC-020.
      if (b.type === 'person.join' || b.type === 'person.leave') {
        const reason = state.applyPerson(b, ord);
        if (reason) {
          events.push({
            actor: 'engine',
            body: {
              type: 'fs.conflict',
              seat: seatId ?? op.actor,
              op: b.type,
              path: b.seat,
              reason,
            },
          });
          continue;
        }
      }
      if (b.type.startsWith('fs.') && b.type !== 'fs.conflict') {
        const reason = state.vfs.apply(b as never, ord);
        if (reason) {
          const path = 'path' in b ? b.path : 'from' in b ? b.from : '';
          events.push({
            actor: 'engine',
            body: {
              type: 'fs.conflict',
              seat: seatId ?? op.actor,
              op: b.type,
              path,
              reason,
            },
          });
          continue;
        }
      }
      events.push(op);
    }
  };
  for (const { seat, session } of sessions) {
    merge(session.ops.list, seat.id);
    events.push({
      actor: 'engine',
      body: {
        type: 'seat.end',
        seat: seat.id,
        note: session.note,
        wake: session.wake,
      },
    });
  }

  for (const t of bulk) merge(t.ops.list);

  // 4. Mail.
  for (const { session } of sessions)
    for (const env of session.outbox)
      deliver(main, scenario, env, state.system);
  for (const t of bulk)
    for (const env of t.outbox) deliver(main, scenario, env, state.system);
  // Queue events change state at once, as in turnStart.
  for (const op of main.list) state.applyLive(op.body);
  drain();
  main.emit('engine', { type: 'turn.end', label });
  drain();

  // 5. Persist.
  const stamped = stamp(events, label, ord);
  for (const e of stamped)
    if (
      e.type === 'seat.end' ||
      e.type === 'cast.rule' ||
      e.type === 'thought' ||
      e.type === 'population.step' ||
      e.type === 'population.pool'
    )
      state.apply(e);
  state.ord = ord;
  run.writeTurn(label, stamped);
  if (pendingRules.length) {
    run.info.pendingCastRules = [];
    run.saveInfo();
  }
  run.project(state);
  run.writeMinds(state);
  const active = sessions.map((s) => s.seat.id);
  const populationMails = bulk.reduce((n, t) => n + t.mails, 0);
  run.commit(
    label,
    `${active.length} working, ${skipped.length} asleep${populationMails ? `, ${populationMails} population mails` : ''}`,
  );
  return {
    label,
    active,
    skipped,
    populationMails,
    events: stamped.length,
    costUsd,
    ms: Math.round(performance.now() - t0),
  };
}

export async function runUntil(
  run: Run,
  untilOrd: number,
  log: Logger = () => {},
) {
  const state = run.load();
  if (state.ord < 0) throw new Error('This run has no genesis turn.');
  const reports: TurnReport[] = [];
  while (state.ord < untilOrd) {
    const r = await runTurn(run, state, log);
    log(
      `${r.label}  ${describeTurn(r.label, run.scenario.calendar)}  working: ${r.active.length}  asleep: ${r.skipped.length}${r.populationMails ? `  population mails: ${r.populationMails}` : ''}  $${r.costUsd.toFixed(4)}  ${(r.ms / 1000).toFixed(1)} s`,
    );
    reports.push(r);
  }
  return reports;
}

export { tagOf };
