import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { loadModels, resolveCast } from '../src/cast.ts';
import { runTurn, runUntil } from '../src/engine.ts';
import type { JournalEvent } from '../src/events.ts';
import { exportData } from '../src/export.ts';
import { seatOfMember } from '../src/scenario.ts';
import { materialize } from '../src/timeline.ts';
import { call, makeRun, type Script, tree } from './helpers.ts';

const ACME = 'acme/acme-mf01';
const BW = 'brightwork/bw01';
const toolCalls = (events: JournalEvent[], seat?: string) =>
  events.filter(
    (e): e is Extract<JournalEvent, { type: 'tool.call' }> =>
      e.type === 'tool.call' && (!seat || e.seat === seat),
  );

/** The fixture, with an agency and a consultancy. */
const withStaffing = (dir: string) => {
  const p = join(dir, 'scenario.yaml');
  writeFileSync(
    p,
    readFileSync(p, 'utf8').replace(
      'orgs: [acme, globex]',
      'orgs: [acme, globex, staffco, brightwork]',
    ),
  );
  writeFileSync(
    join(dir, 'orgs', 'staffco.yaml'),
    `kind: agency
name: StaffCo
domain: staffco.example
host: sc01
people:
  - { user: rita, name: Rita Recruiter, role: recruiter, title: Recruiter }
  - { user: sam, name: Sam Sourcer, role: recruiter, title: Recruiter }
`,
  );
  writeFileSync(
    join(dir, 'orgs', 'brightwork.yaml'),
    `kind: consultancy
name: Brightwork Consulting
domain: brightwork.example
host: bw01
people:
  - { user: colin, name: Colin Lead, role: partner, title: Partner }
`,
  );
};

const runWith = (script: Script) =>
  makeRun(script, 'scripted', 'r', withStaffing);

const ERIN = {
  client: 'acme.example',
  username: 'erin',
  full_name: 'Erin Hire',
  role: 'clerk',
  title: 'Clerk',
};
const KIM = {
  client: 'acme.example',
  username: 'kim',
  full_name: 'Kim Consultant',
  role: 'developer',
  title: 'Consultant',
};

describe('people who join during a run', () => {
  test('the scenario seeds the people at genesis, as person.join events', () => {
    const run = runWith({});
    const joins = run
      .readTurn('fy1-q1-d1-t0')
      .filter((e) => e.type === 'person.join');
    expect(joins.map((e) => e.seat)).toContain('rita@staffco.example');
    expect(joins.every((e) => e.actor === 'genesis')).toBe(true);
    const people = run.load().people;
    expect(people.size).toBe(joins.length);
    expect(people.get('dan@acme.example')?.org).toBe('acme');
  });

  test('an agency places a new employee, who works only after IT makes the account', async () => {
    const run = runWith({
      'rita@staffco.example': {
        'fy1-q1-d1-t1': [call('place_person', ERIN)],
      },
      'alice@acme.example': {
        'fy1-q1-d1-t2': [
          call('useradd', { username: 'erin', full_name: 'Erin Hire' }),
        ],
      },
      'erin@acme.example': {
        'fy1-q1-d1-t2': [call('whoami')],
        'fy1-q1-d1-t3': [call('whoami')],
      },
      'bob@acme.example': {
        'fy1-q1-d1-t1': [call('place_person', ERIN)],
      },
    });
    await runUntil(run, 3);
    const t1 = run.readTurn('fy1-q1-d1-t1');
    const join = t1.find((e) => e.type === 'person.join');
    expect(join).toMatchObject({
      seat: 'erin@acme.example',
      org: 'acme',
      via: 'rita@staffco.example',
    });
    // A company person has no staffing tools.
    expect(toolCalls(t1, 'bob@acme.example')[0].result).toContain(
      'does not exist',
    );
    // The seat exists from turn 2, but it has no account until the end of turn 2.
    expect(
      toolCalls(run.readTurn('fy1-q1-d1-t2'), 'erin@acme.example'),
    ).toEqual([]);
    expect(
      toolCalls(run.readTurn('fy1-q1-d1-t3'), 'erin@acme.example'),
    ).toHaveLength(1);
    expect(run.load().vfs.exists(ACME, '/var/mail/erin/new')).toBe(true);
  });

  test('a consultant belongs to the consultancy: mail on its host, work on the client host', async () => {
    const run = runWith({
      'colin@brightwork.example': {
        'fy1-q1-d1-t1': [call('place_person', KIM)],
      },
      'gina@globex.example': {
        'fy1-q1-d1-t2': [
          call('send_mail', {
            to: 'kim@brightwork.example',
            subject: 'Welcome',
            body: 'Hello Kim.',
          }),
        ],
      },
      'alice@acme.example': {
        'fy1-q1-d1-t2': [
          call('useradd', { username: 'kim', full_name: 'Kim Consultant' }),
        ],
      },
      'kim@brightwork.example': {
        'fy1-q1-d1-t3': [
          call('whoami'),
          call('read_mail', { id: 'fy1-q1-d1-t2.gina.1' }),
          call('write_file', { path: 'notes.md', content: 'On site.\n' }),
        ],
      },
    });
    await runUntil(run, 3);
    const kim = run.load().people.get('kim@brightwork.example');
    expect(kim).toMatchObject({ org: 'brightwork', site: 'acme' });
    const calls = toolCalls(
      run.readTurn('fy1-q1-d1-t3'),
      'kim@brightwork.example',
    );
    expect(calls.map((c) => c.ok)).toEqual([true, true, true]);
    expect(calls[0].result).toContain('host: acme-mf01');
    const state = run.load();
    // The consultancy made its own account at once. The client IT made the other.
    expect(state.vfs.exists(BW, '/home/kim')).toBe(true);
    expect(
      state.vfs.exists(BW, '/var/mail/kim/cur/fy1-q1-d1-t2.gina.1.eml'),
    ).toBe(true);
    expect(state.vfs.exists(ACME, '/home/kim/notes.md')).toBe(true);
    expect(state.vfs.exists(ACME, '/var/mail/kim/cur')).toBe(true);
  });

  test('casts resolve for new people by org and role', async () => {
    const run = runWith({
      'rita@staffco.example': { 'fy1-q1-d1-t1': [call('place_person', ERIN)] },
      'colin@brightwork.example': {
        'fy1-q1-d1-t1': [call('place_person', KIM)],
      },
    });
    await runUntil(run, 1);
    const people = run.load().people;
    const seat = (id: string) => {
      const m = people.get(id);
      if (!m) throw new Error(id);
      return seatOfMember(run.scenario, id, m);
    };
    const cast = {
      default: 'scripted',
      rules: [
        { match: { org: 'acme', role: 'clerk' }, use: 'cheap' },
        { match: { org: 'brightwork' }, use: 'premium' },
      ],
    };
    const models = loadModels(join(run.dir, 'scenario'));
    const actor = (id: string) =>
      resolveCast(models, cast, seat(id), 2, run.scenario.calendar).actorName;
    expect(actor('erin@acme.example')).toBe('cheap-model');
    expect(actor('kim@brightwork.example')).toBe('big-model');
  });

  test('a second join of the same person in one turn is a conflict', async () => {
    const run = runWith({
      'rita@staffco.example': { 'fy1-q1-d1-t1': [call('place_person', ERIN)] },
      'sam@staffco.example': { 'fy1-q1-d1-t1': [call('place_person', ERIN)] },
    });
    await runUntil(run, 1);
    const t1 = run.readTurn('fy1-q1-d1-t1');
    expect(t1.filter((e) => e.type === 'person.join')).toHaveLength(1);
    expect(t1.find((e) => e.type === 'fs.conflict')).toMatchObject({
      seat: 'sam@staffco.example',
      op: 'person.join',
      path: 'erin@acme.example',
    });
  });

  test('a person whose placement ends stops working, and a compel for them is skipped', async () => {
    const run = runWith({
      'rita@staffco.example': {
        'fy1-q1-d1-t1': [call('place_person', ERIN)],
        'fy1-q1-d1-t3': [
          call('end_placement', { address: 'erin@acme.example' }),
        ],
      },
      'sam@staffco.example': {
        'fy1-q1-d1-t3': [
          call('end_placement', { address: 'kim@brightwork.example' }),
        ],
      },
      'alice@acme.example': {
        'fy1-q1-d1-t2': [
          call('useradd', { username: 'erin', full_name: 'Erin Hire' }),
        ],
      },
      'erin@acme.example': {
        'fy1-q1-d1-t3': [call('whoami')],
        'fy1-q1-d1-t4': [call('whoami')],
      },
    });
    run.info.compel = [
      {
        at: 'fy1-q1-d1-t4',
        seat: 'erin@acme.example',
        do: [{ tool: 'whoami', args: {} }],
      },
    ];
    run.saveInfo();
    await runUntil(run, 4);
    expect(
      toolCalls(run.readTurn('fy1-q1-d1-t3'), 'erin@acme.example'),
    ).toHaveLength(1);
    expect(
      toolCalls(run.readTurn('fy1-q1-d1-t3'), 'sam@staffco.example')[0].ok,
    ).toBe(false);
    const t4 = run.readTurn('fy1-q1-d1-t4');
    expect(toolCalls(t4, 'erin@acme.example')).toEqual([]);
    expect(t4.find((e) => e.type === 'compel.skipped')).toMatchObject({
      seat: 'erin@acme.example',
      reason: 'the person is not in the world',
    });
    expect(run.load().people.get('erin@acme.example')?.left).toBe(3);
  });

  test('the fold of the journal equals the live state, people included', async () => {
    const run = runWith({
      'rita@staffco.example': {
        'fy1-q1-d1-t1': [call('place_person', ERIN)],
        'fy1-q1-d1-t2': [
          call('end_placement', { address: 'erin@acme.example' }),
        ],
      },
      'colin@brightwork.example': {
        'fy1-q1-d1-t2': [call('place_person', KIM)],
      },
    });
    const live = run.load();
    for (let i = 0; i < 3; i++) await runTurn(run, live);
    const folded = run.load();
    expect([...folded.people]).toEqual([...live.people]);
    const out = mkdtempSync(join(tmpdir(), 'qc-mat-'));
    materialize(run, 'fy1-q1-d1-t3', out);
    expect(tree(out, (r) => r.endsWith('.qc-manifest.json'))).toEqual(
      tree(join(run.dir, 'world')),
    );
    // The viewer gets every person who was in the world, with join and leave turns.
    const data = exportData(run);
    expect(data.seats.at(-1)).toMatchObject({
      id: 'kim@brightwork.example',
      site: 'acme',
      joined: 2,
    });
    expect(data.seats.find((s) => s.id === 'erin@acme.example')).toMatchObject({
      joined: 1,
      left: 2,
    });
    const erin = data.seats.findIndex((s) => s.id === 'erin@acme.example');
    expect(data.turns[0].actors[erin]).toBe('');
    expect(data.turns[1].actors[erin]).toBe('scripted');
  });
});
