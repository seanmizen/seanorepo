import { genCity } from './gen.ts';
import { evaluate } from './graph.ts';
import { hashNet, run, spent } from './net.ts';
import { parse } from './params.ts';

// Runs the chain. Posts the city once, then a snapshot per step (at most one each 100 ms).
self.onmessage = ({ data }: MessageEvent<string>) => {
  try {
    const p = parse(data);
    const city = genCity(p);
    postMessage({ type: 'city', city });
    let last = 0;
    let hash = '';
    for (const s of run(city, p)) {
      const end = s.step === s.total;
      if (!end && s.step > 0 && performance.now() - last < 100) continue;
      last = performance.now();
      hash = hashNet(s.net);
      const { net, ...rest } = s;
      postMessage({
        type: 'snap',
        ...rest,
        ...evaluate(city, net, p, 256),
        lines: net.lines,
        cost: spent(net),
        hash,
        N: p.N,
        budget: p.budget,
      });
    }
    postMessage({ type: 'done', hash });
  } catch (err) {
    postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
