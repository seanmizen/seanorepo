import type { City } from './gen.ts';
import type { Eval } from './graph.ts';
import type { Net } from './net.ts';

type Task = {
  net: Net;
  S: number;
  ok: (e: Eval) => void;
  fail: (e: Error) => void;
};

// A pool of hardwareConcurrency - 1 workers (at least 1). Each worker gets the city once.
// The result evaluates a network with S job samples in the next free worker. Tasks start in call order.
export function pool(city: City, qs: string) {
  const queue: Task[] = [];
  const idle: Worker[] = [];
  const next = (w: Worker) => {
    const t = queue.shift();
    if (!t) {
      idle.push(w);
      return;
    }
    w.onmessage = ({ data }: MessageEvent<Eval>) => {
      t.ok(data);
      next(w);
    };
    w.onerror = (e) => t.fail(new Error(e.message));
    w.postMessage({ net: t.net, S: t.S });
  };
  for (let k = 0; k < Math.max(1, navigator.hardwareConcurrency - 1); k++) {
    const w = new Worker(new URL('./pool-worker.ts', import.meta.url));
    w.postMessage({ city, qs });
    idle.push(w);
  }
  return (net: Net, S: number) =>
    new Promise<Eval>((ok, fail) => {
      queue.push({ net, S, ok, fail });
      const w = idle.pop();
      if (w) next(w);
    });
}
