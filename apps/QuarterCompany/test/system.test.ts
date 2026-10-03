import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { runUntil } from '../src/engine.ts';
import type { JournalEvent } from '../src/events.ts';
import type { Inject } from '../src/scenario.ts';
import { materialize } from '../src/timeline.ts';
import { call, makeRun, type Script, tree } from './helpers.ts';

const HOST = 'acme/acme-mf01';
const GX = 'globex/gx01';
const toolCalls = (events: JournalEvent[]) =>
  events.filter(
    (e): e is Extract<JournalEvent, { type: 'tool.call' }> =>
      e.type === 'tool.call',
  );

function runWith(script: Script, ...injects: Omit<Inject, 'note'>[]) {
  const run = makeRun(script);
  run.info.injects.push(...injects.map((i) => ({ note: '', ...i })));
  run.saveInfo();
  return run;
}

describe('system events', () => {
  test('host.down: nobody logs in, mail to the host waits, then arrives', async () => {
    const run = runWith(
      {
        'bob@acme.example': { 'fy1-q1-d1-t1': [call('whoami')] },
        'gina@globex.example': {
          'fy1-q1-d1-t1': [
            call('send_mail', {
              to: 'bob@acme.example',
              subject: 'Invoice',
              body: 'Attached.',
            }),
          ],
        },
      },
      {
        at: 'fy1-q1-d1-t1',
        until: 'fy1-q1-d1-t3',
        kind: 'host.down',
        org: 'acme',
      },
    );
    await runUntil(run, 1);
    const t1 = run.readTurn('fy1-q1-d1-t1');
    expect(
      t1.some(
        (e) => e.type === 'seat.blocked' && e.seat === 'bob@acme.example',
      ),
    ).toBe(true);
    expect(toolCalls(t1).some((e) => e.seat === 'bob@acme.example')).toBe(
      false,
    );
    expect(
      t1.some((e) => e.type === 'mail.queued' && e.rcpt === 'bob@acme.example'),
    ).toBe(true);
    await runUntil(run, 3);
    const t3 = run.readTurn('fy1-q1-d1-t3');
    expect(t3.some((e) => e.type === 'system.end')).toBe(true);
    expect(t3.some((e) => e.type === 'mail.dequeued')).toBe(true);
    const state = run.load();
    expect(state.queue).toEqual([]);
    expect(
      state.vfs.exists(HOST, '/var/mail/bob/new/fy1-q1-d1-t1.gina.1.eml'),
    ).toBe(true);
  });

  test('mail.down: people work, but their outgoing mail waits', async () => {
    const run = runWith(
      {
        'bob@acme.example': {
          'fy1-q1-d1-t1': [
            call('write_file', { path: 'a.txt', content: 'ok' }),
            call('send_mail', {
              to: 'gina@globex.example',
              subject: 'Hi',
              body: 'x',
            }),
          ],
        },
      },
      {
        at: 'fy1-q1-d1-t1',
        until: 'fy1-q1-d1-t2',
        kind: 'mail.down',
        org: 'acme',
      },
    );
    await runUntil(run, 1);
    const t1 = run.readTurn('fy1-q1-d1-t1');
    expect(toolCalls(t1).every((e) => e.ok)).toBe(true);
    const q = t1.find((e) => e.type === 'mail.queued');
    expect(q && 'reason' in q && q.reason).toBe(
      'the sender mail service is down',
    );
    await runUntil(run, 2);
    expect(
      run.load().vfs.exists(GX, '/var/mail/gina/new/fy1-q1-d1-t1.bob.1.eml'),
    ).toBe(true);
  });

  test('disk.full: writes fail with "No space left on device"', async () => {
    const run = runWith(
      {
        'bob@acme.example': {
          'fy1-q1-d1-t1': [call('write_file', { path: 'a.txt', content: 'x' })],
        },
      },
      { at: 'fy1-q1-d1-t1', kind: 'disk.full', org: 'acme' },
    );
    await runUntil(run, 1);
    const [c] = toolCalls(run.readTurn('fy1-q1-d1-t1'));
    expect(c.ok).toBe(false);
    expect(c.result).toContain('No space left on device');
  });

  test('the fold of the journal gives the same world, queue included', async () => {
    const run = runWith(
      {
        'gina@globex.example': {
          'fy1-q1-d1-t1': [
            call('send_mail', {
              to: 'bob@acme.example',
              subject: 'One',
              body: 'x',
            }),
          ],
          'fy1-q1-d1-t2': [
            call('send_mail', {
              to: 'bob@acme.example',
              subject: 'Two',
              body: 'y',
            }),
          ],
        },
      },
      {
        at: 'fy1-q1-d1-t1',
        until: 'fy1-q1-d1-t3',
        kind: 'disk.full',
        org: 'acme',
      },
    );
    await runUntil(run, 2);
    expect(run.load().queue.map((q) => q.messageId)).toEqual([
      'fy1-q1-d1-t1.gina.1',
      'fy1-q1-d1-t2.gina.1',
    ]);
    await runUntil(run, 3);
    const out = mkdtempSync(join(tmpdir(), 'qc-mat-'));
    materialize(run, 'fy1-q1-d1-t3', out);
    expect(tree(out, (r) => r.endsWith('.qc-manifest.json'))).toEqual(
      tree(join(run.dir, 'world')),
    );
    expect(run.load().queue).toEqual([]);
  });
});
