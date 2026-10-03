import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { runTurn, runUntil } from '../src/engine.ts';
import type { JournalEvent } from '../src/events.ts';
import type { Run } from '../src/run.ts';
import { journalPathOf } from '../src/time.ts';
import { materialize } from '../src/timeline.ts';
import { call, makeRun, tree } from './helpers.ts';

const HOST = 'acme/acme-mf01';
const toolCalls = (run: Run, label: string) =>
  run
    .readTurn(label)
    .filter(
      (e): e is Extract<JournalEvent, { type: 'tool.call' }> =>
        e.type === 'tool.call',
    );

describe('journal and projection', () => {
  test('the projection equals a fold of the journal', async () => {
    const run = makeRun({
      'bob@acme.example': {
        'fy1-q1-d1-t1': [
          call('write_file', { path: 'a.txt', content: 'one' }),
          call('mkdir', { path: 'docs' }),
        ],
        'fy1-q1-d1-t2': [
          call('mv', { from: 'a.txt', to: 'docs/a.txt' }),
          call('rm', { path: '/tmp/shared.txt' }),
        ],
      },
    });
    await runUntil(run, 3);
    const out = mkdtempSync(join(tmpdir(), 'qc-mat-'));
    materialize(run, 'fy1-q1-d1-t3', out);
    const skip = (rel: string) => rel.endsWith('.qc-manifest.json');
    expect(tree(out, skip)).toEqual(tree(join(run.dir, 'world')));
    expect(
      existsSync(join(run.dir, 'world', HOST, 'home/bob/docs/a.txt')),
    ).toBe(true);
    expect(existsSync(join(run.dir, 'world', HOST, 'tmp/shared.txt'))).toBe(
      false,
    );
  });

  test('a journal file is never rewritten', () => {
    const run = makeRun();
    expect(() => run.writeTurn('fy1-q1-d1-t0', [])).toThrow(/append-only/);
  });

  test('the same decisions give the same journal', async () => {
    const script = {
      'alice@acme.example': {
        'fy1-q1-d1-t1': [
          call('useradd', { username: 'dan', full_name: 'Dan New' }),
        ],
      },
      'bob@acme.example': {
        'fy1-q1-d1-t1': [
          call('send_mail', {
            to: 'carol@acme.example',
            subject: 'hi',
            body: 'hello',
          }),
        ],
      },
    };
    const a = makeRun(script);
    const b = makeRun(script);
    await runUntil(a, 4);
    await runUntil(b, 4);
    for (const label of a.turns()) {
      expect(readFileSync(join(b.dir, journalPathOf(label)), 'utf8')).toBe(
        readFileSync(join(a.dir, journalPathOf(label)), 'utf8'),
      );
    }
  });

  test('each turn is one git commit with a tag', async () => {
    const run = makeRun();
    await runUntil(run, 2);
    const tags = run
      .git('tag', '--list')
      .stdout.split('\n')
      .filter(Boolean)
      .sort();
    expect(tags).toEqual([
      't/fy1-q1-d1-t0',
      't/fy1-q1-d1-t1',
      't/fy1-q1-d1-t2',
    ]);
  });
});

describe('nothing is permanently deleted', () => {
  test('a removed file stays in the object store, and the admin can restore it', async () => {
    const run = makeRun({
      'bob@acme.example': {
        'fy1-q1-d1-t1': [call('rm', { path: '/srv/finance/ledger.csv' })],
      },
      'alice@acme.example': {
        'fy1-q1-d1-t2': [call('restore', { path: '/srv/finance/ledger.csv' })],
      },
    });
    await runUntil(run, 1);
    const write = run
      .readTurn('fy1-q1-d1-t0')
      .find(
        (e) => e.type === 'fs.write' && e.path === '/srv/finance/ledger.csv',
      );
    expect(write && 'hash' in write && run.objects.get(write.hash)).toBe(
      'a,1\n',
    );
    expect(run.load().vfs.exists(HOST, '/srv/finance/ledger.csv')).toBe(false);
    await runUntil(run, 2);
    const n = run.load().vfs.get(HOST, '/srv/finance/ledger.csv');
    expect(n?.owner).toBe('bob');
    expect(n?.group).toBe('finance');
  });
});

describe('permissions', () => {
  test('a user outside the group cannot read team files', async () => {
    const run = makeRun({
      'carol@acme.example': {
        'fy1-q1-d1-t1': [
          call('read_file', { path: '/srv/finance/ledger.csv' }),
        ],
      },
    });
    await runUntil(run, 1);
    const [c] = toolCalls(run, 'fy1-q1-d1-t1');
    expect(c.ok).toBe(false);
    expect(c.result).toContain('Permission denied');
  });

  test('sudo outside wheel is refused and logged, and sudo inside wheel works', async () => {
    const run = makeRun({
      'carol@acme.example': {
        'fy1-q1-d1-t1': [
          call('read_file', { path: '/srv/finance/ledger.csv', sudo: true }),
        ],
      },
      'alice@acme.example': {
        'fy1-q1-d1-t2': [
          call('read_file', { path: '/srv/finance/ledger.csv', sudo: true }),
        ],
      },
    });
    await runUntil(run, 2);
    expect(toolCalls(run, 'fy1-q1-d1-t1')[0].result).toContain(
      'not in the sudoers file',
    );
    expect(toolCalls(run, 'fy1-q1-d1-t2')[0].result).toBe('a,1\n');
    const log = readFileSync(
      join(run.dir, 'world', HOST, 'var/log/auth.log'),
      'utf8',
    );
    expect(log).toContain('carol : user NOT in sudoers');
    expect(log).toContain('alice : COMMAND ALLOWED');
  });

  test('admin tools do not exist for other users', async () => {
    const run = makeRun({
      'bob@acme.example': {
        'fy1-q1-d1-t1': [
          call('useradd', { username: 'eve', full_name: 'Eve' }),
        ],
      },
    });
    await runUntil(run, 1);
    expect(toolCalls(run, 'fy1-q1-d1-t1')[0].result).toContain(
      'does not exist',
    );
  });

  test('a seat with no account does not work until IT makes the account', async () => {
    const run = makeRun({
      'alice@acme.example': {
        'fy1-q1-d1-t1': [
          call('useradd', { username: 'dan', full_name: 'Dan New' }),
        ],
      },
      'dan@acme.example': {
        'fy1-q1-d1-t1': [call('whoami')],
        'fy1-q1-d1-t2': [call('whoami')],
      },
    });
    await runUntil(run, 2);
    expect(
      toolCalls(run, 'fy1-q1-d1-t1').some((c) => c.seat === 'dan@acme.example'),
    ).toBe(false);
    expect(
      toolCalls(run, 'fy1-q1-d1-t2').some((c) => c.seat === 'dan@acme.example'),
    ).toBe(true);
  });

  test('a failed tool changes nothing', async () => {
    const run = makeRun({
      'alice@acme.example': {
        'fy1-q1-d1-t1': [
          call('useradd', {
            username: 'dan',
            full_name: 'Dan',
            groups: ['nope'],
          }),
        ],
      },
    });
    await runUntil(run, 1);
    expect(
      run.readTurn('fy1-q1-d1-t1').some((e) => e.type === 'fs.write'),
    ).toBe(false);
  });
});

describe('mail', () => {
  test('mail arrives at the end of the turn, between companies too', async () => {
    const run = makeRun({
      'bob@acme.example': {
        'fy1-q1-d1-t1': [
          call('send_mail', {
            to: 'gina@globex.example',
            subject: 'Invoice',
            body: 'Attached.',
          }),
        ],
      },
      'gina@globex.example': {
        'fy1-q1-d1-t1': [call('list_mail')],
        'fy1-q1-d1-t2': [call('list_mail')],
      },
    });
    await runUntil(run, 2);
    expect(
      toolCalls(run, 'fy1-q1-d1-t1').find(
        (c) => c.seat === 'gina@globex.example',
      )?.result,
    ).toBe('Your mailbox is empty.');
    expect(toolCalls(run, 'fy1-q1-d1-t2')[0].result).toContain('"Invoice"');
    expect(
      existsSync(
        join(
          run.dir,
          'world/globex/gx01/var/mail/gina/new/fy1-q1-d1-t1.bob.1.eml',
        ),
      ),
    ).toBe(true);
  });

  test('mail to an unknown or locked user bounces', async () => {
    const run = makeRun({
      'alice@acme.example': {
        'fy1-q1-d1-t1': [call('usermod', { username: 'carol', lock: true })],
      },
      'bob@acme.example': {
        'fy1-q1-d1-t2': [
          call('send_mail', {
            to: ['nobody@acme.example', 'carol@acme.example'],
            subject: 'x',
            body: 'y',
          }),
        ],
      },
    });
    await runUntil(run, 2);
    const bounces = run
      .readTurn('fy1-q1-d1-t2')
      .filter((e) => e.type === 'mail.bounce');
    expect(bounces.map((b) => 'reason' in b && b.reason)).toEqual([
      'user unknown',
      'account is locked',
    ]);
    const inbox = run.load().vfs.children(HOST, '/var/mail/bob/new');
    expect(inbox.length).toBe(2);
  });

  test('a sleeping seat wakes when mail arrives', async () => {
    const run = makeRun(
      {
        'bob@acme.example': {
          'fy1-q1-d1-t2': [
            call('send_mail', {
              to: 'carol@acme.example',
              subject: 'wake',
              body: 'up',
            }),
          ],
        },
      },
      'scripted',
    );
    // Carol is idle: she sleeps until mail.
    run.castFile.rules.push({
      match: { user: 'carol@acme.example' },
      use: 'idle',
    });
    const state = run.load();
    const r1 = await runTurn(run, state);
    expect(r1.active).toContain('carol@acme.example');
    const r2 = await runTurn(run, state);
    expect(r2.skipped).toContain('carol@acme.example');
    const r3 = await runTurn(run, state);
    expect(r3.active).toContain('carol@acme.example');
  });
});

describe('time budget', () => {
  test('a tool that needs more minutes than are left is refused', async () => {
    const big = 'x'.repeat(6000); // 10 minutes
    const run = makeRun({
      'bob@acme.example': {
        'fy1-q1-d1-t1': [
          call('write_file', { path: 'a', content: big }),
          call('write_file', { path: 'b', content: big }),
        ],
      },
    });
    await runUntil(run, 1);
    const [a, b] = toolCalls(run, 'fy1-q1-d1-t1');
    expect(a.ok && a.minutes).toBe(10);
    expect(b.ok).toBe(false);
    expect(b.result).toContain('5 minutes left');
  });
});

describe('merge order', () => {
  test('seats merge in seat-id order, and a change that no longer applies is a conflict', async () => {
    const run = makeRun({
      'alice@acme.example': {
        'fy1-q1-d1-t1': [call('rm', { path: '/tmp/shared.txt' })],
      },
      'bob@acme.example': {
        'fy1-q1-d1-t1': [
          call('mv', { from: '/tmp/shared.txt', to: '/tmp/s.txt' }),
        ],
      },
      'carol@acme.example': {
        'fy1-q1-d1-t1': [
          call('write_file', { path: '/tmp/shared.txt', content: 'carol' }),
        ],
      },
    });
    await runUntil(run, 1);
    const events = run.readTurn('fy1-q1-d1-t1');
    const conflict = events.find((e) => e.type === 'fs.conflict');
    expect(conflict && 'seat' in conflict && conflict.seat).toBe(
      'bob@acme.example',
    );
    const n = run.load().vfs.get(HOST, '/tmp/shared.txt');
    expect(n && run.objects.get(n.hash as string)).toBe('carol');
  });
});
