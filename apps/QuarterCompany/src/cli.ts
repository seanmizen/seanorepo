// qc: the QuarterCompany command line. Runs live in $QC_RUNS, or ./runs.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { Rule } from './cast.ts';
import { genesis, runUntil } from './engine.ts';
import { exportHtml } from './export.ts';
import { Run } from './run.ts';
import { labelOf, ordOf, turnsPerDay } from './time.ts';
import {
  costReport,
  materialize,
  playback,
  retake,
  statusLines,
} from './timeline.ts';

const HELP = `qc - QuarterCompany, a turn-based workplace simulator

Usage: qc <command> [options]

  new <run> --scenario <dir> --cast <name> [--replace]
                         Make a run and write its genesis turn.
                         --replace moves an old run of that name to runs/.trash.
  run <run> [--turns N | --days N | --until <turn>]
                         Run turns with the models. Default: 1 turn.
  status <run>           Show the last turn and who plays each seat.
  playback <run> [--from <turn>] [--to <turn>] [--seat <id>] [--verbose]
                         Show turns that happened. No model calls.
  retake <run> --from <turn> [--cast <name>] [--as <new run>]
                         Run again from a turn, in a new run folder.
  recast <run> --use <tier|actor> [--user <id>] [--company <id>] [--role <role>]
                         [--from <turn>] [--until <turn>]
                         Add a cast rule. It applies from the next turn.
  inject <run> --at <turn> --from <addr> --to <addr> --subject <s> --body <b>
                         Schedule an email into the world.
  materialize <run> --at <turn> --out <dir>
                         Build the world at a turn into a folder.
  export <run> [--out <file>] [--fragment]
                         Write one HTML file that plays the run back.
                         Default: runs/<run>.html. No server needed.
  cost <run> [--by seat|actor|role|company]
                         Model cost so far.
  mcp-worker <run> --seat <id>
                         MCP server (stdio): work as one seat.
  mcp-director <run>     MCP server (stdio): drive the simulation.
  list                   List runs.

Turn labels look like fy1-q1-d1-t1.`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    scenario: { type: 'string' },
    cast: { type: 'string' },
    replace: { type: 'boolean' },
    turns: { type: 'string' },
    days: { type: 'string' },
    until: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
    seat: { type: 'string' },
    verbose: { type: 'boolean', short: 'v' },
    as: { type: 'string' },
    use: { type: 'string' },
    user: { type: 'string' },
    company: { type: 'string' },
    role: { type: 'string' },
    at: { type: 'string' },
    subject: { type: 'string' },
    body: { type: 'string' },
    out: { type: 'string' },
    by: { type: 'string' },
    fragment: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

const [command, name] = positionals;
const fail = (msg: string): never => {
  console.error(`qc: ${msg}`);
  process.exit(1);
};
const required = (v: string | undefined, flag: string): string =>
  v ?? fail(`Give --${flag}.`);
const runName = () => name ?? fail('Give the run name.');

async function main() {
  if (!command || values.help) {
    console.log(HELP);
    return;
  }
  switch (command) {
    case 'new': {
      const runs = Run.runsDir();
      const dir = join(runs, runName());
      if (existsSync(dir)) {
        if (!values.replace)
          fail(`Run ${runName()} exists. Use --replace, or another name.`);
        const trash = join(runs, '.trash');
        mkdirSync(trash, { recursive: true });
        renameSync(
          dir,
          join(
            trash,
            `${runName()}-${new Date().toISOString().replace(/[:.]/g, '-')}`,
          ),
        );
      }
      const run = Run.init({
        name: runName(),
        scenarioDir: required(values.scenario, 'scenario'),
        cast: required(values.cast, 'cast'),
      });
      genesis(run);
      console.log(`Made run ${run.info.name} in ${run.dir}. Genesis is done.`);
      return;
    }
    case 'run': {
      const run = Run.open(runName());
      const cal = run.scenario.calendar;
      const last = run.lastOrd();
      const target = values.until
        ? ordOf(values.until, cal)
        : values.days
          ? last + Number(values.days) * turnsPerDay(cal)
          : last + Number(values.turns ?? 1);
      if (target <= last) fail(`The run is already at ${labelOf(last, cal)}.`);
      await runUntil(run, target, (l) => console.log(l));
      return;
    }
    case 'status': {
      for (const line of statusLines(Run.open(runName()))) console.log(line);
      return;
    }
    case 'playback': {
      const run = Run.open(runName());
      for (const line of playback(run, {
        from: values.from,
        to: values.to,
        seat: values.seat,
        verbose: values.verbose,
      })) {
        console.log(line);
      }
      return;
    }
    case 'retake': {
      const src = Run.open(runName());
      const r = retake(src, required(values.from, 'from'), {
        cast: values.cast,
        name: values.as,
      });
      console.log(
        `Made run ${r.info.name}. It starts at ${values.from}. Use "qc run ${r.info.name}" to continue it.`,
      );
      return;
    }
    case 'recast': {
      const run = Run.open(runName());
      const rule = Rule.parse({
        match: {
          user: values.user,
          company: values.company,
          role: values.role,
        },
        use: required(values.use, 'use'),
        from: values.from,
        until: values.until,
      });
      const cal = run.scenario.calendar;
      if (rule.from) ordOf(rule.from, cal);
      if (rule.until) ordOf(rule.until, cal);
      if (!run.models.actors[run.models.tiers[rule.use] ?? rule.use])
        fail(`"${rule.use}" is not an actor or a tier.`);
      run.info.pendingCastRules = [...(run.info.pendingCastRules ?? []), rule];
      run.saveInfo();
      console.log(`Rule added. The next turn records it in the journal.`);
      return;
    }
    case 'inject': {
      const run = Run.open(runName());
      const at = required(values.at, 'at');
      if (ordOf(at, run.scenario.calendar) <= run.lastOrd())
        fail(`Turn ${at} has happened. Give a later turn.`);
      run.info.injects.push({
        at,
        mail: {
          from: required(values.from, 'from'),
          to: required(values.to, 'to'),
          subject: required(values.subject, 'subject'),
          body: required(values.body, 'body'),
        },
      });
      run.saveInfo();
      console.log(`Mail is scheduled for ${at}.`);
      return;
    }
    case 'materialize': {
      const run = Run.open(runName());
      const out = required(values.out, 'out');
      if (existsSync(out) && readdirSync(out).length)
        fail(`Folder ${out} is not empty.`);
      materialize(run, required(values.at, 'at'), out);
      console.log(`Wrote the world at ${values.at} to ${out}.`);
      return;
    }
    case 'export': {
      const run = Run.open(runName());
      const out = values.out ?? join(Run.runsDir(), `${runName()}.html`);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, exportHtml(run, { fragment: values.fragment }));
      console.log(`Wrote ${out}. Open it in a browser.`);
      return;
    }
    case 'cost': {
      const run = Run.open(runName());
      const by = (values.by ?? 'seat') as 'seat' | 'actor' | 'role' | 'company';
      const rows = costReport(run, by);
      if (!rows.length) {
        console.log('No model calls yet.');
        return;
      }
      console.log(
        `${by.padEnd(32)} ${'calls'.padStart(6)} ${'in'.padStart(10)} ${'out'.padStart(9)} ${'USD'.padStart(9)}`,
      );
      for (const r of rows) {
        console.log(
          `${r.key.padEnd(32)} ${String(r.calls).padStart(6)} ${String(r.inputTokens).padStart(10)} ${String(r.outputTokens).padStart(9)} ${r.costUsd.toFixed(4).padStart(9)}`,
        );
      }
      const total = rows.reduce((a, r) => a + r.costUsd, 0);
      console.log(
        `${'total'.padEnd(32)} ${''.padStart(6)} ${''.padStart(10)} ${''.padStart(9)} ${total.toFixed(4).padStart(9)}`,
      );
      return;
    }
    case 'mcp-worker': {
      const { serveWorker } = await import('./mcp/worker.ts');
      await serveWorker(Run.open(runName()), required(values.seat, 'seat'));
      return;
    }
    case 'mcp-director': {
      const { serveDirector } = await import('./mcp/director.ts');
      await serveDirector(Run.open(runName()));
      return;
    }
    case 'list': {
      const runs = Run.runsDir();
      if (!existsSync(runs)) return;
      for (const d of readdirSync(runs).sort()) {
        if (d.startsWith('.') || !existsSync(join(runs, d, 'run.json')))
          continue;
        const r = Run.open(d);
        const last = r.lastOrd();
        console.log(
          `${d.padEnd(40)} ${r.info.cast.padEnd(14)} ${last >= 0 ? labelOf(last, r.scenario.calendar) : '-'}${r.info.parent ? `  (retake of ${r.info.parent.run} from ${r.info.parent.turn})` : ''}`,
        );
      }
      return;
    }
    default:
      fail(`Command "${command}" does not exist. Use qc --help.`);
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
