import type { City } from './gen.ts';
import { evaluate, prep } from './graph.ts';
import { type Params, parse } from './params.ts';

// One worker of the pool. The first message is the city and the parameters.
// Each next message is a network, a number of job samples, and prep to return prep() of the network.
let city: City;
let p: Params;
self.onmessage = ({ data }: MessageEvent) => {
  if (data.city) [city, p] = [data.city, parse(data.qs)];
  else postMessage((data.prep ? prep : evaluate)(city, data.net, p, data.S));
};
