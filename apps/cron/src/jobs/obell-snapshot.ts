/**
 * Fetch obell.dev and compare it with the last snapshot. When the page
 * changed, the run is a notice, its detail is the diff, and the job sends
 * one email with the diff. The first snapshot sends no email.
 */

import { createTwoFilesPatch } from 'diff';
import type { Job } from '../job';

const URL = 'https://obell.dev';

const london = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/London' });

interface Snapshot {
  body: string;
  /** When the runner saw this body first. ISO. */
  since: string;
}

export const obellSnapshot: Job = {
  id: 'obell-snapshot',
  title: 'obell.dev snapshot',
  description:
    'Fetch obell.dev. When the page changes, show the diff here and email it to Sean.',
  schedule: '0 * * * *',
  run: async (ctx) => {
    const res = await fetch(URL, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`${URL} gave HTTP ${res.status}.`);
    const body = await res.text();
    const now = new Date().toISOString();
    const last = ctx.load<Snapshot>();

    if (!last) {
      ctx.save({ body, since: now } satisfies Snapshot);
      return {
        status: 'notice',
        summary: `First snapshot: ${body.length} bytes.`,
      };
    }
    if (last.body === body) {
      return { summary: `No change since ${last.since}.` };
    }

    ctx.save({ body, since: now } satisfies Snapshot);
    const patch = createTwoFilesPatch(
      'obell.dev',
      'obell.dev',
      last.body,
      body,
      last.since,
      now,
    );
    const lines = patch.split('\n');
    const added = lines.filter(
      (l) => l.startsWith('+') && !l.startsWith('+++'),
    ).length;
    const removed = lines.filter(
      (l) => l.startsWith('-') && !l.startsWith('---'),
    ).length;
    const count = (n: number) => `${n} ${n === 1 ? 'line' : 'lines'}`;
    const change = `${count(added)} added, ${count(removed)} removed`;
    const email = await ctx.email(
      'obell.dev changed',
      [
        `${URL} changed: ${change}.`,
        '',
        `Last snapshot: ${london(last.since)} (London)`,
        `This snapshot: ${london(now)}`,
        '',
        'https://seanmizen.com/cron',
        '',
        patch,
      ].join('\n'),
    );
    return {
      status: 'notice',
      summary: `The page changed: ${change}. Email: ${email}.`,
      detail: patch,
    };
  },
};
