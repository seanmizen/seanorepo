/* The web worker of the 30-minute contour. The first message gives the
   walk file, its unzipped size and the network of the city. Each later
   message is a source cell. The reply is a time texture, a byte for each
   cell: 255 x time / 30 min. 255: not in 30 min. */
import { baked, CUTOFF, graph, type Reach, search } from './reach';

type Init = { walk: string; size: number; net: Uint16Array };
let ready: Promise<Reach>;

self.onmessage = async ({ data }: MessageEvent<Init | number>) => {
  if (typeof data !== 'number') {
    ready = baked(data.walk, data.size).then((b) =>
      graph(new Uint16Array(b.buffer), data.net),
    );
    return;
  }
  const g = await ready;
  const dist = search(g, data, CUTOFF);
  const tex = new Uint8Array(g.cells);
  for (let c = 0; c < g.cells; c++)
    tex[c] = dist[c] < CUTOFF ? (255 * dist[c]) / CUTOFF : 255;
  self.postMessage(tex, { transfer: [tex.buffer] });
};
