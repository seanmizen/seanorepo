import { fromBytes, genCity } from './gen.ts';
import { gpu } from './gpu.ts';
import { type Eval, type Prep, samples } from './graph.ts';
import { hashNet, run, type Snap, spent } from './net.ts';
import { parse } from './params.ts';
import { pool } from './pool.ts';

// Runs the chain. Posts the city once, then a snapshot per step (at most one each 100 ms).
// Each batch of greedy candidates gets its J from the pool, or with gpu=1 and WebGPU from the GPU.
// On the GPU, the pool prepares the networks. Anneal and random score on this thread.
self.onmessage = async ({ data }: MessageEvent<string>) => {
  try {
    const p = parse(data);
    const res = p.city ? await fetch(`/cities/${p.city}.bin`) : null;
    if (res && !res.ok) throw new Error(`Unknown city: ${p.city}.`);
    const city = res ? fromBytes(await res.arrayBuffer(), p.city) : genCity(p);
    const S = samples(city, p);
    const score = p.gpu ? await gpu(city, p, S) : null;
    postMessage({ type: 'city', city, gpu: !!score });
    const job = pool(city, data);
    // The pool evaluates each snapshot with 256 samples. The chain posts the snapshots in step order.
    let posted = Promise.resolve();
    let last = 0;
    let hash = '';
    const post = (s: Snap) => {
      const end = s.step === s.total;
      if (!end && s.step > 0 && performance.now() - last < 100) return;
      last = performance.now();
      const { net, ...rest } = s;
      const e = job<Eval>({ net, S: 256 });
      const snap = {
        type: 'snap',
        ...rest,
        lines: net.lines,
        cost: spent(net),
        hash: hashNet(net),
        N: p.N,
        budget: p.budget,
      };
      hash = snap.hash;
      posted = posted.then(async () => postMessage({ ...snap, ...(await e) }));
    };
    const steps = run(city, p);
    for (let r = steps.next(); !r.done; ) {
      const s = r.value;
      if (Array.isArray(s)) {
        const all = <T>(out: 'prep' | 'J') =>
          Promise.all(s.map((net) => job<T>({ net, S, out })));
        r = steps.next(
          score ? await score(await all<Prep>('prep')) : await all<number>('J'),
        );
      } else {
        post(s);
        r = steps.next();
      }
    }
    await posted;
    postMessage({ type: 'done', hash });
  } catch (err) {
    postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
