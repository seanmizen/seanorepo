import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadModels, resolveCast } from '../src/cast.ts';
import { runUntil } from '../src/engine.ts';
import { workerSession } from '../src/mcp/worker.ts';
import { Run } from '../src/run.ts';
import { loadScenario, seatsOf } from '../src/scenario.ts';
import { playback, retake } from '../src/timeline.ts';
import { call, FIXTURE, makeRun } from './helpers.ts';

describe('cast', () => {
  const scenario = loadScenario(FIXTURE);
  const models = loadModels(FIXTURE);
  const seat = (id: string) => {
    const s = seatsOf(scenario).find((x) => x.id === id);
    if (!s) throw new Error(id);
    return s;
  };
  const cast = {
    default: 'cheap',
    rules: [
      { match: { role: 'finance' }, use: 'premium' },
      { match: { company: 'acme' }, use: 'idle' },
      {
        match: { user: 'carol@acme.example' },
        use: 'premium',
        from: 'fy1-q1-d1-t3',
      },
    ],
  };
  const actor = (id: string, ord: number) =>
    resolveCast(models, cast, seat(id), ord, scenario.calendar).actorName;

  test('the most specific rule wins', () => {
    expect(actor('bob@acme.example', 1)).toBe('big-model'); // role beats company
    expect(actor('alice@acme.example', 1)).toBe('idle'); // company
    expect(actor('gina@globex.example', 1)).toBe('cheap-model'); // default tier
  });

  test('a rule applies only inside its window', () => {
    expect(actor('carol@acme.example', 2)).toBe('idle');
    expect(actor('carol@acme.example', 3)).toBe('big-model');
  });

  test('on a tie, the later rule wins, so a recast beats the cast file', () => {
    const recast = {
      ...cast,
      rules: [...cast.rules, { match: { role: 'finance' }, use: 'cheap' }],
    };
    expect(
      resolveCast(
        models,
        recast,
        seat('bob@acme.example'),
        1,
        scenario.calendar,
      ).actorName,
    ).toBe('cheap-model');
  });

  test('an unknown actor or tier is an error', () => {
    expect(() =>
      resolveCast(
        models,
        { default: 'nope', rules: [] },
        seat('bob@acme.example'),
        1,
        scenario.calendar,
      ),
    ).toThrow();
  });
});

describe('playback and retake', () => {
  const script = {
    'bob@acme.example': {
      'fy1-q1-d1-t1': [
        call('write_file', { path: 'v.txt', content: 'first timeline' }),
      ],
      'fy1-q1-d1-t3': [
        call('write_file', { path: 'v.txt', content: 'turn three' }),
      ],
    },
  };

  test('playback reads the journal and shows each tool call', async () => {
    const run = makeRun(script);
    await runUntil(run, 3);
    const text = [...playback(run)].join('\n');
    expect(text).toContain('── fy1-q1-d1-t1');
    expect(text).toContain('bob@acme.example');
    expect(text).toContain('write_file v.txt (14 chars)');
  });

  test('retake makes a new run from a turn and leaves the original alone', async () => {
    const run = makeRun(script);
    await runUntil(run, 4);
    const before = readFileSync(
      join(run.dir, 'world/acme/acme-mf01/home/bob/v.txt'),
      'utf8',
    );
    const r = retake(run, 'fy1-q1-d1-t3', { name: 'alt' });
    expect(r.info.parent).toEqual({ run: 'r', turn: 'fy1-q1-d1-t3' });
    expect(r.lastOrd()).toBe(2);
    expect(
      r.git('tag', '--list').stdout.split('\n').filter(Boolean).sort(),
    ).toEqual(['t/fy1-q1-d1-t0', 't/fy1-q1-d1-t1', 't/fy1-q1-d1-t2']);
    expect(
      readFileSync(join(r.dir, 'world/acme/acme-mf01/home/bob/v.txt'), 'utf8'),
    ).toBe('first timeline');
    await runUntil(r, 3);
    expect(
      readFileSync(join(r.dir, 'world/acme/acme-mf01/home/bob/v.txt'), 'utf8'),
    ).toBe('turn three');
    // The original run did not change.
    expect(new Run(run.dir).lastOrd()).toBe(4);
    expect(
      readFileSync(
        join(run.dir, 'world/acme/acme-mf01/home/bob/v.txt'),
        'utf8',
      ),
    ).toBe(before);
  });

  test('retake can change the cast', () => {
    const run = makeRun(script);
    const r = retake(run, 'fy1-q1-d1-t1', {
      cast: 'external-alice',
      name: 'alt',
    });
    expect(new Run(r.dir).info.cast).toBe('external-alice');
  });
});

describe('external seats through qc-worker', () => {
  test('the worker sees mail injected at the start of its turn', async () => {
    const run = makeRun({}, 'external-alice');
    run.info.injects.push({
      at: 'fy1-q1-d1-t1',
      mail: {
        from: 'boss@acme.example',
        to: 'alice@acme.example',
        subject: 'Hello',
        body: 'Welcome.',
      },
    });
    run.saveInfo();
    const w = workerSession(run, 'alice@acme.example');
    const r = await w.call('list_mail', {});
    expect(r.text).toContain('"Hello"');
    await runUntil(run, 1);
    const replayed = run
      .readTurn('fy1-q1-d1-t1')
      .find((e) => e.type === 'tool.call' && e.seat === 'alice@acme.example');
    expect(replayed && 'result' in replayed && replayed.result).toBe(r.text);
  });

  test('the engine replays what the agent did, with the same results', async () => {
    const run = makeRun({}, 'external-alice');
    const w = workerSession(run, 'alice@acme.example');
    expect(await w.brief()).toContain('Alice Admin');
    const r1 = await w.call('useradd', {
      username: 'dan',
      full_name: 'Dan New',
      groups: ['finance'],
    });
    expect(r1.ok).toBe(true);
    const r2 = await w.call('ls', { path: '/home' });
    expect(r2.text).toContain('dan/');
    expect(
      existsSync(
        join(run.dir, 'pending/fy1-q1-d1-t1/alice@acme.example.jsonl'),
      ),
    ).toBe(true);
    await runUntil(run, 1);
    const calls = run
      .readTurn('fy1-q1-d1-t1')
      .filter((e) => e.type === 'tool.call' && e.seat === 'alice@acme.example');
    expect(calls.map((c) => ('result' in c ? c.result : ''))).toEqual([
      r1.text,
      r2.text,
    ]);
    // The worker now works on the next turn.
    expect(await w.brief()).toContain('fy1-q1-d1-t2');
  });
});
