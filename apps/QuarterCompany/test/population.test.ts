import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { stringify } from 'yaml';
import { runTurn, runUntil } from '../src/engine.ts';
import type { JournalEvent } from '../src/events.ts';
import { exportData } from '../src/export.ts';
import { expand, membersOf, scenarioPopulations } from '../src/population.ts';
import type { Run } from '../src/run.ts';
import { materialize } from '../src/timeline.ts';
import { call, makeRun, type Script, tree } from './helpers.ts';

const POSTBOX = 'postbox/pb01';
const ACME = 'acme/acme-mf01';

interface PopOptions {
  size?: number;
  seed?: number;
  share?: number;
  p?: number;
  modelMail?: boolean;
  extra?: string;
}

/** The fixture, with a mail provider and a population of kettle owners. */
const withPopulation =
  (o: PopOptions = {}) =>
  (dir: string) => {
    const p = join(dir, 'scenario.yaml');
    writeFileSync(
      p,
      readFileSync(p, 'utf8').replace(
        'orgs: [acme, globex]',
        'orgs: [acme, globex, postbox, kettle-owners]',
      ),
    );
    writeFileSync(
      join(dir, 'orgs', 'postbox.yaml'),
      'kind: provider\nname: Postbox Mail\ndomain: postbox.example\nhost: pb01\n',
    );
    writeFileSync(
      join(dir, 'orgs', 'kettle-owners.yaml'),
      stringify({
        kind: 'population',
        name: 'Kettle owners',
        about: 'People who bought a kettle from Acme.',
        provider: 'postbox',
        model_mail: o.modelMail ?? false,
        pool_size: 3,
        members: {
          size: o.size ?? 6,
          seed: o.seed ?? 7,
          traits: [{ key: 'owns', value: 'kettle-k2', share: o.share ?? 1 }],
        },
        behaviour: [
          {
            id: 'k2-fault',
            from: 'fy1-q1-d1-t1',
            who: { owns: 'kettle-k2' },
            p: o.p ?? 1,
            write: {
              to: 'bob@acme.example',
              subject: ['My {owns} kettle is faulty', 'Problem with {owns}'],
              body: 'Hello,\n\nMy {owns} switches off. Please help.\n\n{name}',
            },
            chase: {
              after: '2t',
              subject: 'Re: My kettle',
              body: 'I have no reply yet.\n\n{first}',
            },
            escalate: {
              after: '2t',
              to: 'carol@acme.example',
              subject: 'Complaint: no reply about my kettle',
              body: 'Nobody answers me.\n\n{name}',
            },
          },
        ],
      }) + (o.extra ?? ''),
    );
  };

const toolCalls = (events: JournalEvent[]) =>
  events.filter(
    (e): e is Extract<JournalEvent, { type: 'tool.call' }> =>
      e.type === 'tool.call',
  );

/** The members that the fixture population gets. */
const membersFor = (run: Run) =>
  expand(scenarioPopulations(run.scenario)).get('kettle-owners') ?? [];

const setScript = (run: Run, script: Script) =>
  writeFileSync(
    join(run.dir, 'scenario', 'scripts', 'test.yaml'),
    stringify(script),
  );

describe('populations', () => {
  test('a population is one event at genesis, and the fold makes the members', () => {
    const run = makeRun({}, 'scripted', 'r', withPopulation({ size: 50 }));
    const t0 = run.readTurn('fy1-q1-d1-t0');
    const joins = t0.filter((e) => e.type === 'population.join');
    expect(joins).toHaveLength(1);
    expect(joins[0]).toMatchObject({
      org: 'kettle-owners',
      provider: 'postbox',
    });
    expect(t0.filter((e) => e.type === 'person.join')).toHaveLength(5);
    const state = run.load();
    const members = membersOf(state, 'kettle-owners');
    expect(members).toHaveLength(50);
    expect(new Set(members.map((m) => m.user)).size).toBe(50);
    expect(members[0].traits).toEqual({ owns: ['kettle-k2'] });
    // The same seed gives the same members. Another seed gives others.
    expect(membersFor(run)).toEqual(members);
    const other = expand([
      {
        org: 'kettle-owners',
        provider: 'postbox',
        members: { size: 50, seed: 8, traits: [] },
      },
    ]).get('kettle-owners');
    expect(other?.map((m) => m.user)).not.toEqual(members.map((m) => m.user));
    // Each member has an account on the provider host. Mailboxes come later.
    const passwd = readFileSync(
      join(run.dir, 'world', POSTBOX, 'etc', 'passwd'),
      'utf8',
    );
    for (const m of members) expect(passwd).toContain(`${m.user}:x:`);
    expect(state.vfs.exists(POSTBOX, `/var/mail/${members[0].user}`)).toBe(
      false,
    );
  });

  test('members write in, chase with no reply, then escalate, each as their own tool call', async () => {
    const run = makeRun({}, 'scripted', 'r', withPopulation({ size: 3 }));
    const [m0, m1] = membersFor(run);
    // Bob answers the first member in turn 2.
    setScript(run, {
      'bob@acme.example': {
        'fy1-q1-d1-t2': [
          call('send_mail', {
            to: `${m0.user}@postbox.example`,
            subject: 'Re: your kettle',
            body: 'We send a new kettle today.',
          }),
        ],
      },
    });
    await runUntil(run, 5);
    const t1 = run.readTurn('fy1-q1-d1-t1');
    const sent = toolCalls(t1).filter((c) => c.population === 'kettle-owners');
    expect(sent).toHaveLength(3);
    expect(sent[0]).toMatchObject({ tool: 'send_mail', ok: true });
    expect(sent.map((c) => c.seat)).toContain(`${m1.user}@postbox.example`);
    const body = String((sent[0].args as { body: string }).body);
    expect(body).toContain('kettle-k2');
    expect(body).not.toContain('{');
    // The mail is the member's own: a copy in their sent folder.
    const state = run.load();
    expect(
      state.vfs.exists(
        POSTBOX,
        `/var/mail/${m1.user}/sent/fy1-q1-d1-t1.${m1.user}.1.eml`,
      ),
    ).toBe(true);
    expect(
      state.vfs.children(ACME, '/var/mail/bob/new').length,
    ).toBeGreaterThanOrEqual(3);
    // Turn 3: the first member has a reply. The others chase.
    const steps = (label: string) =>
      run
        .readTurn(label)
        .filter((e) => e.type === 'population.step')
        .map((e) => e.type === 'population.step' && [e.stage, e.users.length]);
    expect(steps('fy1-q1-d1-t3')).toEqual([
      ['answered', 1],
      ['chase', 2],
    ]);
    // Turn 5: two turns after the chase, they escalate to Carol.
    expect(steps('fy1-q1-d2-t1')).toEqual([['escalate', 2]]);
    const esc = toolCalls(run.readTurn('fy1-q1-d2-t1'));
    expect(esc.map((c) => (c.args as { to: string }).to)).toEqual([
      'carol@acme.example',
      'carol@acme.example',
    ]);
    const progress = state.progress.get('kettle-owners/k2-fault');
    expect(progress?.get(m0.user)?.stage).toBe('answered');
    expect(progress?.get(m1.user)?.stage).toBe('escalate');
  });

  test('seeded rules give the same journal for the same seed', async () => {
    const opts = { size: 40, share: 0.5, p: 0.3 };
    const a = makeRun({}, 'scripted', 'a', withPopulation(opts));
    const b = makeRun({}, 'scripted', 'b', withPopulation(opts));
    await runUntil(a, 3);
    await runUntil(b, 3);
    for (const label of a.turns())
      expect(b.readTurn(label)).toEqual(a.readTurn(label));
    const writes = a
      .readTurn('fy1-q1-d1-t1')
      .filter((e) => e.type === 'population.step');
    expect(writes.length).toBeGreaterThan(0);
  });

  test('the fold of the journal equals the live state, populations included', async () => {
    const run = makeRun(
      {},
      'scripted',
      'r',
      withPopulation({ size: 30, share: 0.6, p: 0.4 }),
    );
    const live = run.load();
    for (let i = 0; i < 5; i++) await runTurn(run, live);
    const folded = run.load();
    expect([...folded.populations]).toEqual([...live.populations]);
    expect([...folded.progress].map(([k, v]) => [k, [...v]])).toEqual(
      [...live.progress].map(([k, v]) => [k, [...v]]),
    );
    const out = mkdtempSync(join(tmpdir(), 'qc-mat-'));
    materialize(run, 'fy1-q1-d2-t1', out);
    expect(tree(out, (r) => r.endsWith('.qc-manifest.json'))).toEqual(
      tree(join(run.dir, 'world')),
    );
  });

  test('a system event on the provider host stops the population', async () => {
    const run = makeRun({}, 'scripted', 'r', withPopulation({ size: 3 }));
    run.info.injects = [
      {
        at: 'fy1-q1-d1-t1',
        until: 'fy1-q1-d1-t2',
        kind: 'host.down',
        org: 'postbox',
        note: '',
      },
    ];
    run.saveInfo();
    await runUntil(run, 2);
    const t1 = run.readTurn('fy1-q1-d1-t1');
    expect(t1.find((e) => e.type === 'population.skip')).toMatchObject({
      org: 'kettle-owners',
    });
    expect(toolCalls(t1)).toEqual([]);
    expect(
      toolCalls(run.readTurn('fy1-q1-d1-t2')).filter((c) => c.population),
    ).toHaveLength(3);
  });

  test('the viewer data groups population mail by population', async () => {
    const run = makeRun({}, 'scripted', 'r', withPopulation({ size: 4 }));
    await runUntil(run, 1);
    const d = exportData(run);
    expect(d.populations).toEqual([
      {
        id: 'kettle-owners',
        name: 'Kettle owners',
        provider: 'postbox',
        domain: 'postbox.example',
        size: 4,
      },
    ]);
    // Population members are not staff cards.
    expect(d.seats.some((s) => s.id.endsWith('@postbox.example'))).toBe(false);
    const calls = toolCalls(d.turns[1].events);
    expect(calls.every((c) => c.population === 'kettle-owners')).toBe(true);
  });
});

// A fake openai-compatible model service, for the model-written pool.
const requests: unknown[] = [];
// Set to true to answer as a local reasoning model: a <think> block first.
let thinking = false;
const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => {
    raw += c;
  });
  req.on('end', () => {
    requests.push(JSON.parse(raw));
    const pool = {
      write: [
        {
          subject: 'Kettle {owns} broke',
          body: 'Dear Acme,\nIt broke.\n{name}',
        },
        { subject: 'Help: {owns}', body: 'It stopped. {first}' },
      ],
      chase: [{ subject: 'Still waiting', body: 'Please reply. {first}' }],
      escalate: [{ subject: 'Formal complaint', body: 'No answer. {name}' }],
    };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        model: 'fake-writer',
        choices: [
          {
            message: {
              content: `${thinking ? '<think>The keys are {"write", "chase"}.</think>\n' : ''}Here it is:\n${JSON.stringify(pool)}`,
            },
          },
        ],
        usage: { prompt_tokens: 300, completion_tokens: 200 },
      }),
    );
  });
});
let port = 0;
beforeAll(async () => {
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => {
  server.close();
});

const withWriter = (o: PopOptions) => (dir: string) => {
  withPopulation(o)(dir);
  writeFileSync(
    join(dir, 'providers.yaml'),
    `fake: { kind: openai-compatible, base_url: "http://127.0.0.1:${port}/v1" }\n`,
  );
  writeFileSync(
    join(dir, 'actors.yaml'),
    'actors:\n  scripted: { provider: script, script: scripts/test.yaml }\n  writer: { provider: fake, model: fake-writer, price: { in: 1, out: 2 } }\n',
  );
  writeFileSync(
    join(dir, 'casts', 'writer.yaml'),
    'default: scripted\nrules:\n  - match: { org: kettle-owners }\n    use: writer\n',
  );
};

describe('model-written variant pool', () => {
  test('a model writes the pool once, the object store keeps it, and members reuse it', async () => {
    requests.length = 0;
    const run = makeRun(
      {},
      'writer',
      'r',
      withWriter({ size: 5, modelMail: true }),
    );
    await runUntil(run, 4);
    expect(requests).toHaveLength(1);
    const t1 = run.readTurn('fy1-q1-d1-t1');
    const pool = t1.find((e) => e.type === 'population.pool');
    expect(pool).toMatchObject({ org: 'kettle-owners', actor: 'writer' });
    if (pool?.type !== 'population.pool') throw new Error('no pool');
    expect(JSON.parse(run.objects.get(pool.hash)).write).toHaveLength(2);
    expect(t1.find((e) => e.type === 'model.call')).toMatchObject({
      seat: 'kettle-owners',
      costUsd: (300 * 1 + 200 * 2) / 1e6,
    });
    const subjects = toolCalls(t1).map(
      (c) => (c.args as { subject: string }).subject,
    );
    expect(subjects).toHaveLength(5);
    for (const s of subjects)
      expect(['Kettle kettle-k2 broke', 'Help: kettle-k2']).toContain(s);
    // The chase in turn 3 uses the pool from the journal: no new request.
    const chases = toolCalls(run.readTurn('fy1-q1-d1-t3'));
    expect(chases.map((c) => (c.args as { subject: string }).subject)).toEqual(
      Array(5).fill('Still waiting'),
    );
    // A retake reads the pool from the journal too.
    expect(run.load().pools.get('kettle-owners/k2-fault')).toBe(pool.hash);
  });

  test('a local model writes the pool in offline mode, after its <think> block', async () => {
    requests.length = 0;
    thinking = true;
    process.env.QC_OFFLINE = '1';
    try {
      const run = makeRun(
        {},
        'writer',
        'r',
        withWriter({ size: 5, modelMail: true }),
      );
      await runUntil(run, 1);
      expect(requests).toHaveLength(1);
      const t1 = run.readTurn('fy1-q1-d1-t1');
      expect(t1.find((e) => e.type === 'population.pool')).toBeTruthy();
      expect(t1.find((e) => e.type === 'model.error')).toBeUndefined();
      expect(toolCalls(t1)).toHaveLength(5);
    } finally {
      thinking = false;
      delete process.env.QC_OFFLINE;
    }
  });

  test('model_mail with a cast that gives no model is a model error, and nobody writes', async () => {
    const run = makeRun(
      {},
      'scripted',
      'r',
      withPopulation({ modelMail: true }),
    );
    await runUntil(run, 1);
    const t1 = run.readTurn('fy1-q1-d1-t1');
    const err = t1.find((e) => e.type === 'model.error');
    expect(err && err.type === 'model.error' && err.message).toContain(
      'has no model',
    );
    expect(toolCalls(t1)).toEqual([]);
  });
});

describe('scale', () => {
  test('a turn with about 500 mails from 5,000 members runs in seconds', async () => {
    const t0 = performance.now();
    const run = makeRun(
      {},
      'scripted',
      'scale',
      withPopulation({ size: 5000, share: 0.5, p: 0.2, seed: 11 }),
    );
    const tGenesis = performance.now() - t0;
    const state = run.load();
    expect(membersOf(state, 'kettle-owners')).toHaveLength(5000);
    const t1 = performance.now();
    const report = await runTurn(run, state);
    const tTurn = performance.now() - t1;
    expect(report.populationMails).toBeGreaterThan(400);
    expect(report.populationMails).toBeLessThan(600);
    // A second turn: the mailboxes exist, and the brain checks for replies.
    const t2 = performance.now();
    await runTurn(run, state);
    const tTurn2 = performance.now() - t2;
    const t3 = performance.now();
    const folded = run.load();
    const tFold = performance.now() - t3;
    expect(folded.vfs.children(ACME, '/var/mail/bob/new').length).toBe(
      state.vfs.children(ACME, '/var/mail/bob/new').length,
    );
    console.log(
      `scale: genesis ${tGenesis.toFixed(0)} ms, turn 1 ${tTurn.toFixed(0)} ms (${report.populationMails} mails, ${report.events} events), turn 2 ${tTurn2.toFixed(0)} ms, fold ${tFold.toFixed(0)} ms`,
    );
    expect(tTurn).toBeLessThan(10_000);
    expect(tTurn2).toBeLessThan(10_000);
  }, 60_000);
});
