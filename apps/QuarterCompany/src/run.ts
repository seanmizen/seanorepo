// A run folder holds one timeline:
//
//   run.json      name, cast, parent timeline, director injects
//   scenario/     a copy of the scenario at creation time
//   journal/      append-only JSONL, one file per turn  (the truth)
//   objects/      content-addressed store
//   world/        the projection of the journal          (derived)
//   .git          one commit and one tag per turn
//
// See REQ-QC-001 and REQ-QC-002.
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  type CastFile,
  loadCast,
  loadModels,
  type Models,
  Rule,
} from './cast.ts';
import type { JournalEvent, StateEvent, Wake } from './events.ts';
import { ObjectStore } from './objects.ts';
import { type Inject, loadScenario, type Scenario } from './scenario.ts';
import { journalPathOf, labelOf, ordOf } from './time.ts';
import { modeString, Vfs } from './vfs.ts';

export interface RunInfo {
  name: string;
  cast: string;
  created: string;
  parent?: { run: string; turn: string };
  /** Mail that the director scheduled during the run. */
  injects: Inject[];
  /** Cast rules from the director. The next turn journals them. */
  pendingCastRules?: Rule[];
}

export interface SeatState {
  lastActiveOrd: number;
  note: string;
  wake: Wake;
}

export class SimState {
  vfs = new Vfs();
  seats = new Map<string, SeatState>();
  castRules: Rule[] = [];
  ord = -1;

  apply(e: JournalEvent): string | undefined {
    this.ord = Math.max(this.ord, e.ord);
    switch (e.type) {
      case 'seat.end':
        this.seats.set(e.seat, {
          lastActiveOrd: e.ord,
          note: e.note,
          wake: e.wake,
        });
        return;
      case 'seat.skip':
        return;
      case 'cast.rule':
        this.castRules.push(Rule.parse(e.rule));
        return;
      default:
        if (e.type.startsWith('fs.') && e.type !== 'fs.conflict')
          return this.vfs.apply(e as StateEvent, e.ord);
    }
  }
}

const git = (cwd: string, ...args: string[]) =>
  spawnSync(
    'git',
    ['-c', 'commit.gpgsign=false', '-c', 'tag.gpgSign=false', ...args],
    {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'QuarterCompany',
        GIT_AUTHOR_EMAIL: 'engine@quartercompany.invalid',
        GIT_COMMITTER_NAME: 'QuarterCompany',
        GIT_COMMITTER_EMAIL: 'engine@quartercompany.invalid',
      },
    },
  );

export const tagOf = (label: string) => `t/${label}`;

export class Run {
  readonly objects: ObjectStore;
  readonly scenario: Scenario;
  readonly models: Models;
  readonly castFile: CastFile;
  info: RunInfo;

  constructor(readonly dir: string) {
    if (!existsSync(join(dir, 'run.json')))
      throw new Error(`Folder ${dir} is not a run. It has no run.json.`);
    this.info = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'));
    this.objects = new ObjectStore(join(dir, 'objects'));
    this.scenario = loadScenario(join(dir, 'scenario'));
    this.models = loadModels(join(dir, 'scenario'));
    this.castFile = loadCast(join(dir, 'scenario'), this.info.cast);
  }

  static runsDir(): string {
    return resolve(process.env.QC_RUNS ?? 'runs');
  }

  static open(name: string, runsDir = Run.runsDir()): Run {
    return new Run(join(runsDir, name));
  }

  /** Create the folder, copy the scenario and initialise git. Genesis is the engine's job. */
  static init(opts: {
    name: string;
    scenarioDir: string;
    cast: string;
    runsDir?: string;
  }): Run {
    const dir = join(opts.runsDir ?? Run.runsDir(), opts.name);
    if (existsSync(dir))
      throw new Error(
        `Run folder ${dir} exists. Use another name, or --force.`,
      );
    mkdirSync(dir, { recursive: true });
    cpSync(resolve(opts.scenarioDir), join(dir, 'scenario'), {
      recursive: true,
    });
    loadCast(join(dir, 'scenario'), opts.cast); // fail early on a bad cast name
    const info: RunInfo = {
      name: opts.name,
      cast: opts.cast,
      created: new Date().toISOString(),
      injects: [],
    };
    writeFileSync(join(dir, 'run.json'), `${JSON.stringify(info, null, 2)}\n`);
    writeFileSync(join(dir, '.gitignore'), '.projection.json\n');
    git(dir, 'init', '-q', '-b', 'main');
    return new Run(dir);
  }

  saveInfo() {
    writeFileSync(
      join(this.dir, 'run.json'),
      `${JSON.stringify(this.info, null, 2)}\n`,
    );
  }

  /** Turn labels that have a journal file, in order. */
  turns(): string[] {
    const root = join(this.dir, 'journal');
    if (!existsSync(root)) return [];
    const labels: string[] = [];
    const walk = (dir: string, parts: string[]) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory())
          walk(join(dir, entry.name), [...parts, entry.name]);
        else if (entry.name.endsWith('.jsonl'))
          labels.push([...parts, entry.name.slice(0, -6)].join('-'));
      }
    };
    walk(root, []);
    const cal = this.scenario.calendar;
    return labels.sort((a, b) => ordOf(a, cal) - ordOf(b, cal));
  }

  readTurn(label: string): JournalEvent[] {
    const text = readFileSync(join(this.dir, journalPathOf(label)), 'utf8');
    return text
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  }

  /** Every event, in order, optionally up to and including `toOrd`. */
  *events(toOrd = Number.POSITIVE_INFINITY): Generator<JournalEvent> {
    for (const label of this.turns()) {
      if (ordOf(label, this.scenario.calendar) > toOrd) return;
      yield* this.readTurn(label);
    }
  }

  /** Fold the journal into state. This is the only way state is built. */
  load(toOrd?: number): SimState {
    const state = new SimState();
    for (const e of this.events(toOrd)) state.apply(e);
    return state;
  }

  lastOrd(): number {
    const t = this.turns();
    return t.length ? ordOf(t[t.length - 1], this.scenario.calendar) : -1;
  }

  /** Write one complete turn. A journal file is never rewritten. */
  writeTurn(label: string, events: JournalEvent[]) {
    const path = join(this.dir, journalPathOf(label));
    if (existsSync(path))
      throw new Error(
        `Journal for ${label} exists. The journal is append-only.`,
      );
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      events.map((e) => JSON.stringify(e)).join('\n') +
        (events.length ? '\n' : ''),
    );
  }

  /**
   * Make `outDir` match the filesystem. A manifest records what the last
   * projection wrote, so only changed files are touched.
   */
  project(
    state: SimState,
    outDir = join(this.dir, 'world'),
    manifestPath = join(this.dir, '.projection.json'),
  ) {
    const prev: Record<string, string> = existsSync(manifestPath)
      ? JSON.parse(readFileSync(manifestPath, 'utf8'))
      : {};
    const next: Record<string, string> = {};
    const listings = new Map<string, string[]>();
    for (const host of state.vfs.hosts()) {
      const lines: string[] = [];
      for (const { path, node } of state.vfs.entries(host)) {
        const rel = path === '/' ? host : `${host}${path}`;
        next[rel] = node.kind === 'dir' ? 'dir' : (node.hash as string);
        lines.push(
          [
            modeString(node),
            node.owner.padEnd(8),
            node.group.padEnd(10),
            String(node.size ?? 0).padStart(7),
            labelOf(node.mtime, this.scenario.calendar).padEnd(16),
            path,
          ].join(' '),
        );
      }
      listings.set(host, lines);
    }
    // Remove files and folders that the new state does not have, deepest first.
    const isDir = (v: string | undefined) => v === 'dir';
    const gone = Object.keys(prev)
      .filter(
        (rel) =>
          next[rel] === undefined || isDir(prev[rel]) !== isDir(next[rel]),
      )
      .sort((a, b) => b.length - a.length);
    for (const rel of gone) {
      const p = join(outDir, rel);
      if (!existsSync(p)) continue;
      if (!isDir(prev[rel])) unlinkSync(p);
      else if (readdirSync(p).length === 0) rmdirSync(p);
    }
    for (const rel of Object.keys(next).sort()) {
      const p = join(outDir, rel);
      if (next[rel] === 'dir') mkdirSync(p, { recursive: true });
      else if (prev[rel] !== next[rel] || !existsSync(p)) {
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, this.objects.get(next[rel]));
      }
    }
    for (const [host, lines] of listings)
      writeFileSync(join(outDir, `${host}.ls-lR`), `${lines.join('\n')}\n`);
    writeFileSync(manifestPath, JSON.stringify(next));
  }

  commit(label: string, message: string) {
    const add = git(this.dir, 'add', '-A');
    if (add.error) return; // git is not installed: the journal is still the truth
    git(
      this.dir,
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      `${label}: ${message}`,
    );
    git(this.dir, 'tag', tagOf(label));
  }

  git(...args: string[]) {
    return git(this.dir, ...args);
  }
}
