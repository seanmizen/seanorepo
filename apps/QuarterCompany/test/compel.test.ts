import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { runTurn, runUntil } from '../src/engine.ts';
import type { JournalEvent } from '../src/events.ts';
import { workerSession } from '../src/mcp/worker.ts';
import { call, makeRun } from './helpers.ts';

const HOST = 'acme/acme-mf01';
const MAIL = {
  to: 'carol@acme.example',
  subject: 'Budget',
  body: 'Please send the budget.',
};
const toolCalls = (events: JournalEvent[]) =>
  events.filter(
    (e): e is Extract<JournalEvent, { type: 'tool.call' }> =>
      e.type === 'tool.call',
  );

/** Add a compel entry to the fixture scenario before the run starts. */
const withCompel = (entries: string) => (dir: string) => {
  const p = join(dir, 'scenario.yaml');
  writeFileSync(p, `${readFileSync(p, 'utf8')}compel:\n${entries}`);
};

describe('compelled actions', () => {
  test('a compelled mail is the seat’s own: in its sent folder, and marked in the journal', async () => {
    const run = makeRun(
      {},
      'scripted',
      'r',
      withCompel(
        `  - at: fy1-q1-d1-t1\n    seat: bob@acme.example\n    do:\n      - tool: send_mail\n        args: { to: carol@acme.example, subject: Budget, body: "Please send the budget." }\n`,
      ),
    );
    await runUntil(run, 1);
    const [c] = toolCalls(run.readTurn('fy1-q1-d1-t1'));
    expect(c.seat).toBe('bob@acme.example');
    expect(c.compelled).toBe('scenario');
    const state = run.load();
    expect(
      state.vfs.exists(HOST, '/var/mail/bob/sent/fy1-q1-d1-t1.bob.1.eml'),
    ).toBe(true);
    expect(
      state.vfs.exists(HOST, '/var/mail/carol/new/fy1-q1-d1-t1.bob.1.eml'),
    ).toBe(true);
  });

  test('the briefing tells the seat what it was made to do', async () => {
    const run = makeRun({}, 'external-alice');
    run.info.compel = [
      {
        at: 'fy1-q1-d1-t1',
        seat: 'alice@acme.example',
        do: [{ tool: 'send_mail', args: MAIL }],
      },
    ];
    run.saveInfo();
    const w = workerSession(run, 'alice@acme.example');
    const brief = await w.brief();
    expect(brief).toContain('At the start of this turn, you did these things:');
    expect(brief).toContain('You sent mail to carol@acme.example: "Budget"');
    // The agent's own call comes after the compelled one, in the engine too.
    const r = await w.call('list_mail', {});
    await runUntil(run, 1);
    const calls = toolCalls(run.readTurn('fy1-q1-d1-t1')).filter(
      (e) => e.seat === 'alice@acme.example',
    );
    expect(calls.map((e) => [e.tool, e.compelled])).toEqual([
      ['send_mail', 'director'],
      ['list_mail', undefined],
    ]);
    expect(calls[1].result).toBe(r.text);
  });

  test('a compelled seat works even when it is asleep', async () => {
    const run = makeRun();
    run.castFile.rules.push({
      match: { user: 'carol@acme.example' },
      use: 'idle',
    });
    const state = run.load();
    await runTurn(run, state); // carol goes to sleep until mail
    run.info.compel = [
      {
        at: 'fy1-q1-d1-t2',
        seat: 'carol@acme.example',
        do: [{ tool: 'whoami', args: {} }],
      },
    ];
    const r = await runTurn(run, state);
    expect(r.active).toContain('carol@acme.example');
    expect(
      toolCalls(run.readTurn('fy1-q1-d1-t2')).some(
        (e) => e.seat === 'carol@acme.example' && e.compelled,
      ),
    ).toBe(true);
  });

  test('a seat with no account cannot be compelled', async () => {
    const run = makeRun();
    run.info.compel = [
      {
        at: 'fy1-q1-d1-t1',
        seat: 'dan@acme.example',
        do: [{ tool: 'whoami', args: {} }],
      },
    ];
    await runUntil(run, 1);
    const skipped = run
      .readTurn('fy1-q1-d1-t1')
      .find((e) => e.type === 'compel.skipped');
    expect(skipped && 'seat' in skipped && skipped.seat).toBe(
      'dan@acme.example',
    );
  });
});

describe('injects', () => {
  test('an inject from a person in the simulation is refused', () => {
    const bad = (dir: string) => {
      const p = join(dir, 'scenario.yaml');
      writeFileSync(
        p,
        `${readFileSync(p, 'utf8')}injects:\n  - at: fy1-q1-d1-t1\n    mail: { from: bob@acme.example, to: carol@acme.example, subject: x, body: y }\n`,
      );
    };
    expect(() => makeRun({}, 'scripted', 'r', bad)).toThrow(/Use compel/);
  });

  test('mail from outside keeps a sent copy on the internet host', async () => {
    const run = makeRun({
      'bob@acme.example': { 'fy1-q1-d1-t1': [call('whoami')] },
    });
    run.info.injects.push({
      at: 'fy1-q1-d1-t1',
      mail: {
        from: 'client@example.org',
        to: 'bob@acme.example',
        subject: 'Hi',
        body: 'Hello.',
      },
    });
    run.saveInfo();
    await runUntil(run, 1);
    expect(
      run
        .load()
        .vfs.exists(
          'internet/mx',
          '/client@example.org/sent/fy1-q1-d1-t1.inject.1.eml',
        ),
    ).toBe(true);
  });
});
