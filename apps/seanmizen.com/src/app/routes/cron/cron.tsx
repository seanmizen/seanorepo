import type { FC } from 'react';
import { useEffect, useState } from 'react';
import { SiteTitle } from '@/components';
import styles from './cron.module.css';

/* The shape of GET /api/cron. apps/cron/src/runner.ts makes it. */
type Status = 'ok' | 'notice' | 'alert' | 'error';

interface Run {
  id: number;
  startedAt: string;
  durationMs: number;
  status: Status;
  summary: string;
  detail: string | null;
}

interface Job {
  id: string;
  title: string;
  description: string;
  schedule: string;
  human: string;
  nextRun: string | null;
  running: boolean;
  runs: Run[];
  lastNotable: Run | null;
}

interface CronData {
  timezone: string;
  jobs: Job[];
}

/* The page asks for new data this often. */
const POLL_MS = 30_000;

const when = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleString('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

const ago = (iso: string) => {
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const s = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const abs = Math.abs(s);
  if (abs < 60) return rtf.format(s, 'second');
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(s / 3600), 'hour');
  return rtf.format(Math.round(s / 86_400), 'day');
};

const Dot: FC<{ status: Status }> = ({ status }) => (
  <span className={`${styles.dot} ${styles[status]}`} aria-hidden="true" />
);

const JobCard: FC<{ job: Job; timeZone: string }> = ({ job, timeZone }) => {
  const [last] = job.runs;
  const notable = job.lastNotable;
  return (
    <section className={styles.job} aria-labelledby={`job-${job.id}`}>
      <h2 id={`job-${job.id}`}>{job.title}</h2>
      <p>{job.description}</p>
      <dl className={styles.facts}>
        <dt>Schedule</dt>
        <dd>
          <code>{job.schedule}</code> ({job.human})
        </dd>
        <dt>Next run</dt>
        <dd>
          {job.running
            ? 'running now'
            : job.nextRun
              ? `${when(job.nextRun, timeZone)} (${ago(job.nextRun)})`
              : 'none'}
        </dd>
        <dt>Last run</dt>
        <dd>
          {last ? (
            <>
              <Dot status={last.status} />
              {last.status}: {last.summary}{' '}
              <small>
                ({ago(last.startedAt)}, {last.durationMs} ms)
              </small>
            </>
          ) : (
            'not yet'
          )}
        </dd>
      </dl>

      {job.runs.length > 0 && (
        <ol className={styles.strip} aria-label="Recent runs, oldest first">
          {[...job.runs].reverse().map((run) => (
            <li
              key={run.id}
              className={styles[run.status]}
              title={`${when(run.startedAt, timeZone)}: ${run.status}. ${run.summary}`}
            >
              <span className="sr-only">
                {when(run.startedAt, timeZone)}: {run.status}
              </span>
            </li>
          ))}
        </ol>
      )}

      {notable && notable.id !== last?.id && (
        <p>
          <Dot status={notable.status} />
          Last {notable.status}: {notable.summary}{' '}
          <small>({when(notable.startedAt, timeZone)})</small>
        </p>
      )}

      {notable?.detail && (
        <details className={styles.detail}>
          <summary>
            Detail of the last {notable.status} (
            {when(notable.startedAt, timeZone)})
          </summary>
          <pre>
            <code>{notable.detail}</code>
          </pre>
        </details>
      )}

      {job.runs.length > 0 && (
        <details className={styles.runs}>
          <summary>All {job.runs.length} recent runs</summary>
          <ul>
            {job.runs.map((run) => (
              <li key={run.id}>
                <Dot status={run.status} />
                {when(run.startedAt, timeZone)}: {run.status}. {run.summary}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
};

/**
 * The scheduled jobs on the home server, and their recent runs. The page
 * only reads. The jobs live in apps/cron/src/registry.ts.
 */
const Cron: FC = () => {
  const [data, setData] = useState<CronData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const res = await fetch('/api/cron');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as CronData;
        if (live) {
          setData(body);
          setError(null);
        }
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : String(e));
      }
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <main className="container">
      <div className={styles.page}>
        <SiteTitle path="cron" />
        <p>The scheduled jobs on my home server. The times are London time.</p>
        {error && (
          <p>
            <output>The jobs did not load: {error}.</output>
          </p>
        )}
        {!data && !error && <p>Loading.</p>}
        {data?.jobs.map((job) => (
          <JobCard key={job.id} job={job} timeZone={data.timezone} />
        ))}
      </div>
    </main>
  );
};

export { Cron };
