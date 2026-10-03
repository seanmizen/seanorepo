// Playback, retake and reports. See REQ-QC-011 and REQ-QC-012.
//
// - Playback shows turns that already happened. It reads the journal and
//   never calls a model.
// - Retake goes back to a turn and runs it again with the models. It always
//   makes a new run folder: a new timeline. The original is not changed.
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadCast, resolveCast } from './cast.ts';
import type { JournalEvent } from './events.ts';
import { Run, tagOf } from './run.ts';
import { seatsOf } from './scenario.ts';
import { describeTurn, labelOf, ordOf } from './time.ts';

export interface PlaybackOptions {
  from?: string;
  to?: string;
  seat?: string;
  verbose?: boolean;
}

const short = (v: unknown, n = 80) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  const one = s.replace(/\s+/g, ' ');
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

const argSummary = (tool: string, args: Record<string, unknown>) => {
  switch (tool) {
    case 'send_mail':
      return `to ${short(args.to, 60)}: "${short(args.subject, 50)}"`;
    case 'write_file':
    case 'append_file':
      return `${args.path} (${String(args.content ?? '').length} chars)`;
    case 'end_turn':
      return '';
    default:
      return Object.entries(args)
        .map(([k, v]) => (k === 'sudo' ? (v ? 'sudo' : '') : `${short(v, 50)}`))
        .filter(Boolean)
        .join(' ');
  }
};

/** One line of narration for an event, or undefined to hide it. */
export function narrate(e: JournalEvent, verbose = false): string | undefined {
  switch (e.type) {
    case 'tool.call': {
      const mark = e.ok ? '' : `  ✗ ${short(e.result, 70)}`;
      const line = `  ${e.seat.padEnd(28)} ${e.tool} ${argSummary(e.tool, e.args as Record<string, unknown>)} (${e.minutes} min)${mark}`;
      return verbose && e.ok
        ? `${line}\n${e.result
            .split('\n')
            .slice(0, 8)
            .map((l) => `      │ ${l}`)
            .join('\n')}`
        : line;
    }
    case 'seat.end':
      if (!e.note && !verbose) return undefined;
      return `  ${e.seat.padEnd(28)} ⏹ ${e.wake === 'on_mail' ? 'sleeps until mail' : 'done'}${e.note ? `: "${short(e.note, 90)}"` : ''}`;
    case 'seat.skip':
      return verbose ? `  ${e.seat.padEnd(28)} 💤 ${e.reason}` : undefined;
    case 'inject':
      return `  ✉ ${e.from} → ${e.to.join(', ')}: "${short(e.subject, 60)}" (injected)`;
    case 'mail.bounce':
      return `  ✉ bounce: ${e.messageId} to ${e.to} (${e.reason})`;
    case 'fs.conflict':
      return `  ⚠ ${e.seat}: ${e.op} ${e.path} did not apply: ${e.reason}`;
    case 'model.call':
      return verbose
        ? `  ${e.seat.padEnd(28)} 🧠 ${e.actor} (${e.model}) ${e.inputTokens} in, ${e.outputTokens} out, $${e.costUsd.toFixed(4)}`
        : undefined;
    case 'model.error':
      return `  ${e.seat.padEnd(28)} ✗ model error (${e.actor}): ${short(e.message, 80)}`;
    case 'security':
      return `  🔒 ${e.seat}: ${e.message}`;
    case 'cast.rule':
      return `  🎭 recast: ${short(e.rule, 100)}`;
    case 'fs.write':
    case 'fs.mkdir':
    case 'fs.rm':
      return verbose
        ? `      ${e.actor} ${e.type} ${e.host}:${e.path}`
        : undefined;
    case 'fs.mv':
      return verbose
        ? `      ${e.actor} fs.mv ${e.host}:${e.from} → ${e.to}`
        : undefined;
    case 'fs.meta':
      return verbose
        ? `      ${e.actor} fs.meta ${e.host}:${e.path}`
        : undefined;
    default:
      return undefined;
  }
}

export function* playback(
  run: Run,
  opts: PlaybackOptions = {},
): Generator<string> {
  const cal = run.scenario.calendar;
  const from = opts.from ? ordOf(opts.from, cal) : 0;
  const to = opts.to ? ordOf(opts.to, cal) : Number.POSITIVE_INFINITY;
  for (const label of run.turns()) {
    const ord = ordOf(label, cal);
    if (ord < from) continue;
    if (ord > to) return;
    const lines: string[] = [];
    for (const e of run.readTurn(label)) {
      if (opts.seat && 'seat' in e && e.seat !== opts.seat) continue;
      const line = narrate(e, opts.verbose);
      if (line) lines.push(line);
    }
    if (!lines.length && !opts.verbose) continue;
    yield `── ${label}  ${describeTurn(label, cal)} ──`;
    yield* lines;
  }
}

/** Build the world as it was at the end of a turn, into any folder. */
export function materialize(run: Run, label: string, outDir: string) {
  const state = run.load(ordOf(label, run.scenario.calendar));
  mkdirSync(outDir, { recursive: true });
  run.project(state, outDir, join(outDir, '.qc-manifest.json'));
}

export function retake(
  src: Run,
  fromLabel: string,
  opts: { name?: string; cast?: string } = {},
): Run {
  const cal = src.scenario.calendar;
  const fromOrd = ordOf(fromLabel, cal);
  if (fromOrd < 1)
    throw new Error(
      'A retake must start at turn 1 or later. Genesis comes from the scenario.',
    );
  if (fromOrd > src.lastOrd() + 1)
    throw new Error(
      `Turn ${fromLabel} is after the end of run ${src.info.name}.`,
    );
  const prev = labelOf(fromOrd - 1, cal);
  if (
    src.git('rev-parse', '-q', '--verify', `refs/tags/${tagOf(prev)}`)
      .status !== 0
  ) {
    throw new Error(
      `Run ${src.info.name} has no git tag ${tagOf(prev)}. A retake needs git.`,
    );
  }
  let name = opts.name ?? `${src.info.name}-retake-${fromLabel}`;
  if (!opts.name)
    for (let n = 2; existsSync(join(dirname(src.dir), name)); n++)
      name = `${src.info.name}-retake-${fromLabel}-${n}`;
  const dst = join(dirname(src.dir), name);
  if (existsSync(dst)) throw new Error(`Run folder ${dst} exists.`);
  if (opts.cast) loadCast(join(src.dir, 'scenario'), opts.cast);

  src.git('clone', '-q', src.dir, dst);
  const g = (...args: string[]) => {
    const r = src.git('-C', dst, ...args);
    if (r.status !== 0)
      throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
    return r.stdout;
  };
  g('checkout', '-q', '-B', 'main', tagOf(prev));
  g('remote', 'remove', 'origin');
  // Tags at or after the retake point belong to the other timeline.
  for (const tag of g('tag', '--list', 't/*').split('\n').filter(Boolean)) {
    if (ordOf(tag.slice(2), cal) >= fromOrd) g('tag', '-d', tag);
  }
  const run = new Run(dst);
  run.info = {
    ...run.info,
    name,
    cast: opts.cast ?? src.info.cast,
    parent: { run: src.info.name, turn: fromLabel },
    pendingCastRules: [],
  };
  run.saveInfo();
  const fresh = new Run(dst); // reload with the new cast
  fresh.project(fresh.load());
  g('add', '-A');
  g(
    'commit',
    '-q',
    '-m',
    `retake of ${src.info.name} from ${fromLabel}${opts.cast ? ` with cast ${opts.cast}` : ''}`,
  );
  return fresh;
}

export interface CostRow {
  key: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export function costReport(
  run: Run,
  by: 'seat' | 'actor' | 'role' | 'company' = 'seat',
): CostRow[] {
  const seats = new Map(
    run.scenario.companies.flatMap((c) =>
      c.people.map((p) => [
        `${p.user}@${c.domain}`,
        { role: p.role, company: c.id },
      ]),
    ),
  );
  const rows = new Map<string, CostRow>();
  for (const e of run.events()) {
    if (e.type !== 'model.call') continue;
    const info = seats.get(e.seat);
    const key =
      by === 'seat'
        ? e.seat
        : by === 'actor'
          ? e.actor
          : by === 'role'
            ? (info?.role ?? '?')
            : (info?.company ?? '?');
    const row = rows.get(key) ?? {
      key,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    };
    row.calls += 1;
    row.inputTokens += e.inputTokens;
    row.outputTokens += e.outputTokens;
    row.costUsd += e.costUsd;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.costUsd - a.costUsd);
}

export function statusLines(run: Run): string[] {
  const cal = run.scenario.calendar;
  const state = run.load();
  const next = state.ord + 1;
  const out = [
    `Run ${run.info.name}: scenario ${run.scenario.name}, cast ${run.info.cast}`,
  ];
  if (run.info.parent)
    out.push(`Retake of ${run.info.parent.run} from ${run.info.parent.turn}`);
  out.push(
    `Last turn: ${labelOf(state.ord, cal)} (${describeTurn(labelOf(state.ord, cal), cal)})`,
  );
  out.push(`Next turn: ${labelOf(next, cal)}`, '');
  const cast = {
    ...run.castFile,
    rules: [
      ...run.castFile.rules,
      ...state.castRules,
      ...(run.info.pendingCastRules ?? []),
    ],
  };
  for (const seat of seatsOf(run.scenario)) {
    const c = resolveCast(run.models, cast, seat, next, cal);
    const s = state.seats.get(seat.id);
    const mode = s
      ? s.wake === 'on_mail'
        ? 'asleep'
        : 'awake'
      : 'not started';
    out.push(
      `${seat.id.padEnd(32)} ${seat.person.role.padEnd(14)} ${c.actorName.padEnd(12)} via ${c.via.padEnd(10)} ${mode}`,
    );
  }
  return out;
}
