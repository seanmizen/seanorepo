/**
 * The jobs that the cron service runs. To add a job, write a file in
 * `src/jobs/` and add it to this list. To remove a job, delete its line.
 * The dashboard at seanmizen.com/cron shows each job in this list, in this
 * order. The runs of a removed job stay in the database, and the dashboard
 * does not show them.
 */

import type { Job } from './job';
import { obellSnapshot } from './jobs/obell-snapshot';
import { obellUptime } from './jobs/obell-uptime';

export const registry: Job[] = [obellUptime, obellSnapshot];
