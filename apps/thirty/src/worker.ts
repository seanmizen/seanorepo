import { fromBytes, genCity } from './gen.ts';
import { gpu } from './gpu.ts';
import { type Eval, type Prep, samples, spent } from './graph.ts';
import { hashNet, type Net, run, type Snap } from './net.ts';
import { parse } from './params.ts';
import { pool } from './pool.ts';

// Runs the chain. Posts the city once, then a snapshot for each step: its lines, J and cost.
// The map score (256 samples) of a step comes in a separate message: at most one each 100 ms, the last step,
// and any step the page asks for with its step number.
// Each batch of greedy candidates gets its J from the pool, or with gpu=1 and WebGPU from the GPU.
// On the GPU, the pool prepares the networks. Anneal and random score on this thread.
let mapScore = (_step: number) => {};
self.onmessage = async ({ data }: MessageEvent<string | number>) => {
  if (typeof data === 'number') return mapScore(data);
  try {
    const p = parse(data);
    const res = p.city ? await fetch(`/cities/${p.city}.bin`) : null;
    if (res && !res.ok) throw new Error(`Unknown city: ${p.city}.`);
    const city = res ? fromBytes(await res.arrayBuffer(), p.city) : genCity(p);
    const S = samples(city, p);
    const score = p.gpu ? await gpu(city, p, S) : null;
    postMessage({ type: 'city', city, gpu: !!score });
    const job = pool(city, data);
    // The networks of all steps, so that the pool can score any step later.
    const nets: Net[] = [];
    let posted = Promise.resolve();
    mapScore = (step) => {
      const e = job<Eval>({ net: nets[step], S: 256 });
      posted = posted.then(async () =>
        postMessage({ type: 'score', ...(await e), step }),
      );
    };
    let last = 0;
    let hash = '';
    const post = (s: Snap) => {
      const { net, ...rest } = s;
      nets.push(net);
      hash = hashNet(net);
      postMessage({
        type: 'snap',
        ...rest,
        lines: net.lines,
        cost: spent(net),
        hash,
        N: p.N,
        budget: p.budget,
      });
      if (s.step < s.total && s.step > 0 && performance.now() - last < 100)
        return;
      last = performance.now();
      mapScore(s.step);
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
