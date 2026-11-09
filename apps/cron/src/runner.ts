/**
 * Runs the jobs on their schedules, and records each run. Croner owns the
 * clock. Its `protect` option skips a tick while the last run of the same
 * job has not finished.
 */

import { Cron } from 'croner';
import cronstrue from 'cronstrue';
import {
  addRun,
  type Db,
  lastNotable,
  loadState,
  recentRuns,
  saveState,
} from './db';
import { sendEmail } from './email';
import type { Job, Status } from './job';
import { log } from './log';

export const TIMEZONE = 'Europe/London';
/** How many runs of each job the API gives. */
const RECENT = 48;

const LOG_FOR: Record<Status, (message: string) => void> = {
  ok: log.debug,
  notice: log.info,
  alert: log.warn,
  error: log.error,
};

/** Run one job one time, and record the run. It never throws. */
export const runJob = async (db: Db, job: Job) => {
  const startedAt = new Date().toISOString();
  const start = performance.now();
  let status: Status;
  let summary: string;
  let detail: string | null = null;
  try {
    const outcome = await job.run({
      load: <T>() => loadState<T>(db, job.id),
      save: (value) => saveState(db, job.id, value),
      email: (subject, text) => sendEmail({ subject, text }),
    });
    status = outcome.status ?? 'ok';
    summary = outcome.summary;
    detail = outcome.detail ?? null;
  } catch (error) {
    status = 'error';
    summary = error instanceof Error ? error.message : String(error);
    detail = error instanceof Error ? (error.stack ?? null) : null;
  }
  const durationMs = Math.round(performance.now() - start);
  addRun(db, { job: job.id, startedAt, durationMs, status, summary, detail });
  LOG_FOR[status](`${job.id} ${status} in ${durationMs} ms: ${summary}`);
};

/** Check the registry. Throws on a repeated id or a bad expression. */
export const checkRegistry = (jobs: Job[]) => {
  const ids = new Set<string>();
  for (const job of jobs) {
    if (ids.has(job.id)) throw new Error(`Two jobs have the id "${job.id}".`);
    ids.add(job.id);
    // A bad pattern throws here.
    new Cron(job.schedule, { paused: true, timezone: TIMEZONE }).stop();
  }
};

export const startJobs = (db: Db, jobs: Job[]) => {
  checkRegistry(jobs);
  const crons = new Map<string, Cron>();
  for (const job of jobs) {
    crons.set(
      job.id,
      new Cron(
        job.schedule,
        { name: job.id, timezone: TIMEZONE, protect: true },
        () => runJob(db, job),
      ),
    );
  }
  log.info(`started ${jobs.length} jobs: ${jobs.map((j) => j.id).join(', ')}`);
  return crons;
};

const human = (schedule: string) => {
  try {
    return cronstrue.toString(schedule, { use24HourTimeFormat: true });
  } catch {
    return schedule;
  }
};

/** The body of GET /api/cron. */
export const dashboard = (db: Db, jobs: Job[], crons: Map<string, Cron>) => ({
  timezone: TIMEZONE,
  now: new Date().toISOString(),
  jobs: jobs.map((job) => {
    const cron = crons.get(job.id);
    return {
      id: job.id,
      title: job.title,
      description: job.description,
      schedule: job.schedule,
      human: human(job.schedule),
      nextRun: cron?.nextRun()?.toISOString() ?? null,
      running: cron?.isBusy() ?? false,
      runs: recentRuns(db, job.id, RECENT),
      lastNotable: lastNotable(db, job.id),
    };
  }),
});
