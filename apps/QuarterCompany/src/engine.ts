// The turn engine. One turn:
//
//   1. Journal the director's recasts. Deliver injected mail.
//   2. Every active seat works on its own copy of the same snapshot, at the
//      same time.
//   3. Merge the seats' changes in seat-id order. A change that no longer
//      applies becomes an fs.conflict event.
//   4. Deliver the turn's mail.
//   5. Write the journal, update the projection, commit and tag.
//
// The order in step 3 does not depend on which seat finished first, so the
// journal is the same for the same decisions. See REQ-QC-008.
import { brainFor } from './brains/index.ts';
import { type Casting, resolveCast } from './cast.ts';
import type { EventBody, JournalEvent } from './events.ts';
import { Ops } from './ops.ts';
import { briefing, systemPrompt } from './prompt.ts';
import { type Run, type SimState, tagOf } from './run.ts';
import { type Seat, seatsOf } from './scenario.ts';
import { Session } from './session.ts';
import { describeTurn, GENESIS, isFirstSlotOfDay, labelOf } from './time.ts';
import { Directory } from './users.ts';
import { deliver, injectMail, seedWorld } from './world.ts';

export interface TurnReport {
  label: string;
  active: string[];
  skipped: string[];
  events: number;
  costUsd: number;
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
    .children(seat.host, `/var/mail/${seat.person.user}/new`)
    .filter((k) => k.node.mtime >= sinceOrd).length;

const unreadCount = (state: SimState, seat: Seat) =>
  state.vfs.children(seat.host, `/var/mail/${seat.person.user}/new`).length;

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
 * recasts, then injected mail. The qc-worker server runs the same step on a
 * copy, so an external agent sees the same snapshot as the engine.
 */
export function turnStart(run: Run, ops: Ops, label: string) {
  const clock = describeTurn(label, run.scenario.calendar);
  for (const rule of run.info.pendingCastRules ?? [])
    ops.emit('director', { type: 'cast.rule', rule });
  const injects = [
    ...run.scenario.injects.map((i) => ({ ...i, source: 'scenario' as const })),
    ...run.info.injects.map((i) => ({ ...i, source: 'director' as const })),
  ].filter((i) => i.at === label);
  injects.forEach((inj, n) => {
    injectMail(ops, run.scenario, label, clock, inj.mail, n + 1, inj.source);
  });
}

export async function runTurn(
  run: Run,
  state: SimState,
  log: Logger = () => {},
): Promise<TurnReport> {
  const { scenario } = run;
  const cal = scenario.calendar;
  const ord = state.ord + 1;
  const label = labelOf(ord, cal);
  const clock = describeTurn(label, cal);
  const events: { actor: string; body: EventBody }[] = [];
  const main = new Ops(state.vfs, run.objects, ord);
  const drain = () => {
    events.push(...main.list);
    main.list = [];
  };

  main.emit('engine', { type: 'turn.start', label, clock });
  // 1. Recasts from the director, then injected mail.
  const pendingRules = run.info.pendingCastRules ?? [];
  turnStart(run, main, label);
  drain();
  const castRules = [...state.castRules];
  for (const e of events)
    if (e.body.type === 'cast.rule') castRules.push(e.body.rule as never);
  const cast = {
    ...run.castFile,
    rules: [...run.castFile.rules, ...castRules],
  };

  // 2. Decide who works, then let them work.
  const sessions: { seat: Seat; session: Session; casting: Casting }[] = [];
  const skipped: string[] = [];
  for (const seat of seatsOf(scenario)) {
    const dir = Directory.load(state.vfs, run.objects, seat.host);
    if (!dir.canLogin(seat.person.user)) continue;
    const casting = resolveCast(run.models, cast, seat, ord, cal);
    // A sleeping seat costs nothing. Scripts name their own turns, so they never sleep.
    const prev = state.seats.get(seat.id);
    const asleep =
      prev?.wake === 'on_mail' &&
      !isFirstSlotOfDay(label) &&
      unreadSince(state, seat, prev.lastActiveOrd) === 0;
    if (asleep && casting.actor.provider !== 'script') {
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
      session: new Session(
        seat,
        scenario,
        label,
        ord,
        state.vfs.clone(),
        run.objects,
      ),
    });
  }

  let costUsd = 0;
  await pool(
    sessions,
    scenario.concurrency,
    async ({ seat, session, casting }) => {
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
            unreadCount(state, seat),
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
              request: run.objects.putJson(c.request),
              response: run.objects.putJson(c.response),
            });
          },
        });
      } catch (err) {
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

  // 3. Merge in seat order.
  for (const { seat, session } of sessions) {
    for (const op of session.ops.list) {
      const b = op.body;
      if (b.type.startsWith('fs.') && b.type !== 'fs.conflict') {
        const reason = state.vfs.apply(b as never, ord);
        if (reason) {
          const path = 'path' in b ? b.path : 'from' in b ? b.from : '';
          events.push({
            actor: 'engine',
            body: {
              type: 'fs.conflict',
              seat: seat.id,
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

  // 4. Mail.
  for (const { session } of sessions)
    for (const env of session.outbox) deliver(main, scenario, env);
  drain();
  main.emit('engine', { type: 'turn.end', label });
  drain();

  // 5. Persist.
  const stamped = stamp(events, label, ord);
  for (const e of stamped)
    if (e.type === 'seat.end' || e.type === 'cast.rule') state.apply(e);
  state.ord = ord;
  run.writeTurn(label, stamped);
  if (pendingRules.length) {
    run.info.pendingCastRules = [];
    run.saveInfo();
  }
  run.project(state);
  const active = sessions.map((s) => s.seat.id);
  run.commit(label, `${active.length} working, ${skipped.length} asleep`);
  return { label, active, skipped, events: stamped.length, costUsd };
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
      `${r.label}  ${describeTurn(r.label, run.scenario.calendar)}  working: ${r.active.length}  asleep: ${r.skipped.length}  $${r.costUsd.toFixed(4)}`,
    );
    reports.push(r);
  }
  return reports;
}

export { tagOf };
