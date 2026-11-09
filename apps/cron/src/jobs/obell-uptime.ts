/**
 * Fetch obell.dev. When it goes down, send one email with a report. When it
 * comes back, send one more. While it stays down, send nothing.
 */

import type { Job } from '../job';

const URL = 'https://obell.dev';
const TIMEOUT_MS = 15_000;

interface State {
  down: boolean;
  /** When the site went down or came back. ISO. */
  since: string;
}

const london = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/London' });

/** Fetch the page. Returns null when it is up, or why it is down. */
const check = async (): Promise<{ problem: string | null; ms: number }> => {
  const start = performance.now();
  let problem: string | null = null;
  try {
    const res = await fetch(URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    await res.arrayBuffer();
    if (!res.ok) problem = `HTTP ${res.status} ${res.statusText}`.trim();
  } catch (error) {
    problem =
      error instanceof Error && error.name === 'TimeoutError'
        ? `no answer in ${TIMEOUT_MS / 1000} s`
        : String(error instanceof Error ? error.message : error);
  }
  return { problem, ms: Math.round(performance.now() - start) };
};

export const obellUptime: Job = {
  id: 'obell-uptime',
  title: 'obell.dev uptime',
  description:
    'Fetch obell.dev. Email Sean when it goes down, and when it comes back.',
  schedule: '*/5 * * * *',
  run: async (ctx) => {
    const now = new Date().toISOString();
    const last = ctx.load<State>();
    const { problem, ms } = await check();

    if (!problem) {
      if (!last?.down) {
        if (!last) ctx.save({ down: false, since: now } satisfies State);
        return { summary: `Up. HTTP 200 in ${ms} ms.` };
      }
      ctx.save({ down: false, since: now } satisfies State);
      const email = await ctx.email(
        'obell.dev is up again',
        [
          `${URL} is up again.`,
          '',
          `Down from: ${london(last.since)}`,
          `Up at:     ${london(now)}`,
          `Answer:    HTTP 200 in ${ms} ms`,
          '',
          'https://seanmizen.com/cron',
        ].join('\n'),
      );
      return {
        status: 'notice',
        summary: `Up again after a down from ${london(last.since)}. Email: ${email}.`,
      };
    }

    if (last?.down) {
      return {
        status: 'alert',
        summary: `Still down since ${london(last.since)}: ${problem}.`,
      };
    }

    ctx.save({ down: true, since: now } satisfies State);
    const report = [
      `${URL} is down.`,
      '',
      `Checked at: ${london(now)} (London)`,
      `Problem:    ${problem}`,
      `Time taken: ${ms} ms`,
      `Up before:  ${last ? `since ${london(last.since)}` : 'no earlier check'}`,
      '',
      'The next check is in 5 minutes. You get one more email when it is up again.',
      'https://seanmizen.com/cron',
    ].join('\n');
    const email = await ctx.email('obell.dev is down', report);
    return {
      status: 'alert',
      summary: `Down: ${problem}. Email: ${email}.`,
      detail: report,
    };
  },
};
