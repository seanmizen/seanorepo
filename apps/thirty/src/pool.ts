import type { City } from './gen.ts';
import type { Net } from './net.ts';

// out: what the worker returns. 'prep': prep(). 'J': J of evaluate(). Nothing: evaluate().
type Job = { net: Net; S: number; out?: 'prep' | 'J' };
type Task = Job & { ok: (r: unknown) => void; fail: (e: Error) => void };

// A pool of n workers, by default hardwareConcurrency - 1 (at least 1). Each worker gets the city once.
// The result runs a job in the next free worker. Jobs start in call order. stop() ends the workers.
export function pool(
  city: City,
  qs: string,
  n = Math.max(1, navigator.hardwareConcurrency - 1),
) {
  const queue: Task[] = [];
  const idle: Worker[] = [];
  const next = (w: Worker) => {
    const t = queue.shift();
    if (!t) {
      idle.push(w);
      return;
    }
    w.onmessage = ({ data }: MessageEvent) => {
      t.ok(data);
      next(w);
    };
    w.onerror = (e) => t.fail(new Error(e.message));
    w.postMessage({ net: t.net, S: t.S, out: t.out });
  };
  for (let k = 0; k < n; k++) {
    const w = new Worker(new URL('./pool-worker.ts', import.meta.url));
    w.postMessage({ city, qs });
    idle.push(w);
  }
  const all = [...idle];
  const job = <T>(j: Job) =>
    new Promise<T>((ok, fail) => {
      queue.push({ ...j, ok: ok as (r: unknown) => void, fail });
      const w = idle.pop();
      if (w) next(w);
    });
  return Object.assign(job, {
    stop: () => {
      for (const w of all) w.terminate();
    },
  });
}
