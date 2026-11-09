import type { City } from './gen.ts';
import type { Net } from './net.ts';

// The worker returns evaluate() of the network, or prep() if prep is true.
type Job = { net: Net; S: number; prep?: boolean };
type Task = Job & { ok: (r: unknown) => void; fail: (e: Error) => void };

// A pool of hardwareConcurrency - 1 workers (at least 1). Each worker gets the city once.
// The result runs a job in the next free worker. Jobs start in call order.
export function pool(city: City, qs: string) {
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
    w.postMessage({ net: t.net, S: t.S, prep: t.prep });
  };
  for (let k = 0; k < Math.max(1, navigator.hardwareConcurrency - 1); k++) {
    const w = new Worker(new URL('./pool-worker.ts', import.meta.url));
    w.postMessage({ city, qs });
    idle.push(w);
  }
  return <T>(job: Job) =>
    new Promise<T>((ok, fail) => {
      queue.push({ ...job, ok: ok as (r: unknown) => void, fail });
      const w = idle.pop();
      if (w) next(w);
    });
}
