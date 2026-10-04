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
import type { EventBody, JournalEvent, StateEvent, Wake } from './events.ts';
import { ObjectStore } from './objects.ts';
import {
  type Compel,
  checkInject,
  type Inject,
  loadScenario,
  type Member,
  type Scenario,
} from './scenario.ts';
import { describeTurn, journalPathOf, labelOf, ordOf } from './time.ts';
import { modeString, Vfs } from './vfs.ts';
import type { QueuedMail, SystemStatus } from './world.ts';

export interface RunInfo {
  name: string;
  cast: string;
  created: string;
  parent?: { run: string; turn: string };
  /** Mail that the director scheduled during the run. */
  injects: Inject[];
  /** Actions that the director compelled during the run. */
  compel?: Compel[];
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
  /** Private thoughts per seat, oldest first. Never part of the world. */
  thoughts = new Map<string, { label: string; text: string }[]>();
  /** Active system events per host. See REQ-QC-017. */
  system: SystemStatus = new Map();
  /** Mail that waits for a host or a mail service. One item per recipient. */
  queue: QueuedMail[] = [];
  /** Every person who joined the world, by seat id. See REQ-QC-020. */
  people = new Map<string, Member>();
  ord = -1;

  /** A copy for a preview, for example the qc-worker server. */
  clone(): SimState {
    const c = new SimState();
    c.vfs = this.vfs.clone();
    c.seats = new Map(this.seats);
    c.castRules = [...this.castRules];
    c.thoughts = new Map(this.thoughts);
    c.system = new Map([...this.system].map(([h, k]) => [h, new Set(k)]));
    c.queue = [...this.queue];
    c.people = new Map(this.people);
    c.ord = this.ord;
    return c;
  }

  /**
   * Apply the system and queue events at once. The engine calls this during
   * a turn, and the fold calls it through apply, so both agree.
   */
  applyLive(e: EventBody) {
    switch (e.type) {
      case 'system.start': {
        const set = this.system.get(e.host) ?? new Set();
        set.add(e.kind);
        this.system.set(e.host, set);
        return;
      }
      case 'system.end':
        this.system.get(e.host)?.delete(e.kind);
        return;
      case 'mail.queued':
        this.queue.push({
          messageId: e.messageId,
          hash: e.hash,
          from: e.from,
          rcpt: e.rcpt,
        });
        return;
      case 'mail.dequeued':
        this.queue = this.queue.filter(
          (q) => !(q.messageId === e.messageId && q.rcpt === e.rcpt),
        );
        return;
    }
  }

  /**
   * Apply a join or a leave. Returns the reason when the event does not
   * apply: a join for a person who is in the world, or a leave for a person
   * who is not. The engine records that as a conflict (REQ-QC-008).
   */
  applyPerson(
    e: Extract<EventBody, { type: 'person.join' | 'person.leave' }>,
    ord: number,
  ): string | undefined {
    const cur = this.people.get(e.seat);
    const present = !!cur && cur.left === undefined;
    if (e.type === 'person.join') {
      if (present) return 'the person is in the world';
      this.people.set(e.seat, {
        org: e.org,
        person: e.person,
        ...(e.site ? { site: e.site } : {}),
        via: e.via,
        joined: ord,
      });
      return;
    }
    if (!cur || !present) return 'the person is not in the world';
    this.people.set(e.seat, { ...cur, left: ord });
  }

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
      case 'system.start':
      case 'system.end':
      case 'mail.queued':
      case 'mail.dequeued':
        this.applyLive(e);
        return;
      case 'person.join':
      case 'person.leave':
        return this.applyPerson(e, e.ord);
      case 'thought': {
        const list = this.thoughts.get(e.seat) ?? [];
        list.push({ label: e.turn, text: e.text });
        this.thoughts.set(e.seat, list);
        return;
      }
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
    for (const inj of this.info.injects) checkInject(this.scenario, inj);
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

  /**
   * Write each seat's private thoughts to minds/<seat>.md, outside world/.
   * Like world/, this is derived from the journal. See REQ-QC-014.
   */
  writeMinds(state: SimState) {
    const dir = join(this.dir, 'minds');
    for (const [seat, list] of state.thoughts) {
      mkdirSync(dir, { recursive: true });
      const body = list
        .map(
          (t) =>
            `## ${t.label} (${describeTurn(t.label, this.scenario.calendar)})\n\n${t.text.trim()}\n`,
        )
        .join('\n');
      writeFileSync(
        join(dir, `${seat}.md`),
        `# Private thoughts of ${state.people.get(seat)?.person.name ?? seat}\n\nNobody in the simulation can read this file.\n\n${body}`,
      );
    }
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
