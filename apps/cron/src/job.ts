/**
 * The shape of a job. A job is one file in `src/jobs/`, and `src/registry.ts`
 * lists it. The runner calls `run` on each tick of `schedule`.
 */

/**
 * - ok: the job ran, and there is nothing to see.
 * - notice: the job ran, and found something to see (a page changed).
 * - alert: the job ran, and found something wrong (a site is down).
 * - error: the job itself failed. The runner sets it when `run` throws.
 */
export type Status = 'ok' | 'notice' | 'alert' | 'error';

/** What a run gives back. A run that throws gets the status `error`. */
export interface Outcome {
  /** Default `ok`. */
  status?: Exclude<Status, 'error'>;
  /** One line for the dashboard. */
  summary: string;
  /** Text for the dashboard, for example a diff. At most 64 KB is kept. */
  detail?: string;
}

/** The result of `ctx.email`. `off`: no SMTP settings, so the email went to stdout. */
export type EmailResult = 'sent' | 'off' | 'failed';

export interface JobContext {
  /** The value that this job saved last time, or undefined. */
  load: <T>() => T | undefined;
  /** Save a JSON value for the next run of this job. */
  save: (value: unknown) => void;
  /** Send a plain-text email to CRON_EMAIL_TO. */
  email: (subject: string, text: string) => Promise<EmailResult>;
}

export interface Job {
  /** Stable. The database keys the runs and the saved value on it. */
  id: string;
  title: string;
  /** One sentence for the dashboard. */
  description: string;
  /** A cron expression, in London time. Five fields, or six with seconds first. */
  schedule: string;
  run: (ctx: JobContext) => Promise<Outcome>;
}
