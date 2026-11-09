import type { City } from './gen.ts';
import { evaluate, prep } from './graph.ts';
import { type Params, parse } from './params.ts';

// One worker of the pool. The first message is the city and the parameters.
// Each next message is a network, a number of job samples, and out: 'prep' to return prep() of the network,
// 'J' to return only J, or nothing to return evaluate(). A prep moves its buffers, so there is no copy.
let city: City;
let p: Params;
self.onmessage = ({ data }: MessageEvent) => {
  if (data.city) [city, p] = [data.city, parse(data.qs)];
  else if (data.out === 'prep') {
    const r = prep(city, data.net, p, data.S);
    const transfer = [r.cells, r.off, r.ent, r.D].map((a) => a.buffer);
    postMessage(r, { transfer: transfer as ArrayBuffer[] });
  } else {
    const e = evaluate(city, data.net, p, data.S);
    postMessage(data.out === 'J' ? e.J : e);
  }
};
