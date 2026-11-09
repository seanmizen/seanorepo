/**
 * Fetch obell.dev and compare it with the last snapshot. When the page
 * changed, the run is a notice, and its detail is the diff.
 */

import { createTwoFilesPatch } from 'diff';
import type { Job } from '../job';

const URL = 'https://obell.dev';

interface Snapshot {
  body: string;
  /** When the runner saw this body first. ISO. */
  since: string;
}

export const obellSnapshot: Job = {
  id: 'obell-snapshot',
  title: 'obell.dev snapshot',
  description: 'Fetch obell.dev, and show a diff when the page changes.',
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
    return {
      status: 'notice',
      summary: `The page changed: ${count(added)} added, ${count(removed)} removed.`,
      detail: patch,
    };
  },
};
