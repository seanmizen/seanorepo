import { afterEach, describe, expect, mock, test } from 'bun:test';
import { openDb, recentRuns } from './db';
import { devOutbox } from './email';
import type { Job } from './job';
import { obellSnapshot } from './jobs/obell-snapshot';
import { obellUptime } from './jobs/obell-uptime';
import { registry } from './registry';
import { checkRegistry, dashboard, runJob, startJobs } from './runner';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  devOutbox.length = 0;
});

/** Make each fetch answer with this body and status, or throw this error. */
const serve = (answer: { body?: string; status?: number } | Error) => {
  globalThis.fetch = mock(async () => {
    if (answer instanceof Error) throw answer;
    return new Response(answer.body ?? '', { status: answer.status ?? 200 });
  }) as unknown as typeof fetch;
};

const job = (run: Job['run']): Job => ({
  id: 'test',
  title: 'test',
  description: 'test',
  schedule: '* * * * *',
  run,
});

describe('runner', () => {
  test('records an ok run, and keeps the saved value', async () => {
    const db = openDb(':memory:');
    const counter = job(async (ctx) => {
      const n = (ctx.load<number>() ?? 0) + 1;
      ctx.save(n);
      return { summary: `run ${n}` };
    });
    await runJob(db, counter);
    await runJob(db, counter);
    const runs = recentRuns(db, 'test', 10);
    expect(runs.map((r) => r.summary)).toEqual(['run 2', 'run 1']);
    expect(runs[0].status).toBe('ok');
  });

  test('records a run that throws as an error', async () => {
    const db = openDb(':memory:');
    await runJob(
      db,
      job(async () => {
        throw new Error('boom');
      }),
    );
    const [run] = recentRuns(db, 'test', 1);
    expect(run.status).toBe('error');
    expect(run.summary).toBe('boom');
  });

  test('refuses a bad expression and a repeated id', () => {
    expect(() =>
      checkRegistry([
        { ...job(async () => ({ summary: '' })), schedule: 'nope' },
      ]),
    ).toThrow();
    const a = job(async () => ({ summary: '' }));
    expect(() => checkRegistry([a, a])).toThrow('Two jobs');
  });

  test('the registry is valid, and the dashboard describes each job', () => {
    const db = openDb(':memory:');
    const crons = startJobs(db, registry);
    const body = dashboard(db, registry, crons);
    for (const cron of crons.values()) cron.stop();
    expect(body.jobs.map((j) => j.id)).toEqual(registry.map((j) => j.id));
    const uptime = body.jobs.find((j) => j.id === 'obell-uptime');
    expect(uptime?.human).toBe('Every 5 minutes');
    expect(uptime?.nextRun).not.toBeNull();
  });
});

describe('obell-snapshot', () => {
  test('saves a first snapshot, then sees no change, then gives a diff', async () => {
    const db = openDb(':memory:');
    serve({ body: '<p>one</p>\n' });
    await runJob(db, obellSnapshot);
    await runJob(db, obellSnapshot);
    serve({ body: '<p>two</p>\n' });
    await runJob(db, obellSnapshot);
    const [changed, same, first] = recentRuns(db, 'obell-snapshot', 3);
    expect(first.status).toBe('notice');
    expect(same.status).toBe('ok');
    expect(changed.status).toBe('notice');
    expect(changed.summary).toContain('1 line added, 1 line removed');
    expect(changed.detail).toContain('-<p>one</p>');
    expect(changed.detail).toContain('+<p>two</p>');
  });

  test('a bad answer is an error', async () => {
    const db = openDb(':memory:');
    serve({ status: 503 });
    await runJob(db, obellSnapshot);
    expect(recentRuns(db, 'obell-snapshot', 1)[0].status).toBe('error');
  });
});

describe('obell-uptime', () => {
  test('emails one time when it goes down, and one time when it comes back', async () => {
    const db = openDb(':memory:');
    serve({ body: 'hi' });
    await runJob(db, obellUptime);
    serve({ status: 502 });
    await runJob(db, obellUptime);
    await runJob(db, obellUptime);
    serve(new Error('connect ECONNREFUSED'));
    await runJob(db, obellUptime);
    serve({ body: 'hi' });
    await runJob(db, obellUptime);
    await runJob(db, obellUptime);

    const statuses = recentRuns(db, 'obell-uptime', 10)
      .map((r) => r.status)
      .reverse();
    expect(statuses).toEqual(['ok', 'alert', 'alert', 'alert', 'notice', 'ok']);
    expect(devOutbox.map((e) => e.subject)).toEqual([
      'obell.dev is down',
      'obell.dev is up again',
    ]);
    expect(devOutbox[0].text).toContain('HTTP 502');
  });
});
