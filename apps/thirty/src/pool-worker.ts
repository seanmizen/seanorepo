import type { City } from './gen.ts';
import { evaluate } from './graph.ts';
import { type Params, parse } from './params.ts';

// One worker of the pool. The first message is the city and the parameters.
// Each next message is a network and a number of job samples.
let city: City;
let p: Params;
self.onmessage = ({ data }: MessageEvent) => {
  if (data.city) [city, p] = [data.city, parse(data.qs)];
  else postMessage(evaluate(city, data.net, p, data.S));
};
