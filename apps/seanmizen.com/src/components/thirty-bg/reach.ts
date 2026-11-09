/* The search behind the 30-minute contour. It reads the graph that
   apps/thirty/scripts/bake.ts writes: walkTimes() and netTimes() in
   apps/thirty/src/graph.ts. Times are in tenths of a minute, as in thirty.
   A test in apps/thirty compares search() with thirty's own dijkstra(). */

export type Reach = {
  cells: number;
  off: Int32Array;
  to: Int32Array;
  w: Uint16Array;
  dist: Int32Array;
  hk: Int32Array;
  hv: Int32Array;
};

export const CUTOFF = 300; // N, 30 min.
const UNREACHED = 0x3fffffff;
const ALIGHT = 5; // 0.5 min.

/* A CSR graph: the cells, then a node for each stop of each line. */
export function graph(walk: Uint16Array, net: Uint16Array): Reach {
  const cells = walk.length / 4;
  const side = Math.round(Math.sqrt(cells));
  const step = [1, side, side + 1, side - 1]; // East, south, south-east, south-west.
  const a: number[] = [];
  const b: number[] = [];
  const t: number[] = [];
  const both = (u: number, v: number, x: number) => {
    a.push(u, v);
    b.push(v, u);
    t.push(x, x);
  };
  for (let i = 0; i < cells; i++)
    for (let s = 0; s < 4; s++)
      if (walk[4 * i + s]) both(i, i + step[s], walk[4 * i + s]);
  let id = cells;
  for (let k = 0; k < net.length; ) {
    const [board, n, m] = [net[k], net[k + 1], net[k + 2]];
    const stops = net.subarray(k + 3, k + 3 + n);
    const rides = net.subarray(k + 3 + n, k + 3 + n + m);
    stops.forEach((c, j) => {
      a.push(c, id + j);
      b.push(id + j, c);
      t.push(board, ALIGHT);
    });
    for (let j = 0; j < m; j++) both(id + j, id + ((j + 1) % n), rides[j]);
    id += n;
    k += 3 + n + m;
  }
  const off = new Int32Array(id + 1);
  for (const u of a) off[u + 1]++;
  for (let u = 0; u < id; u++) off[u + 1] += off[u];
  const fill = off.slice(0, id);
  const to = new Int32Array(a.length);
  const w = new Uint16Array(a.length);
  a.forEach((u, e) => {
    const j = fill[u]++;
    to[j] = b[e];
    w[j] = t[e];
  });
  const heap = () => new Int32Array(a.length + 1);
  return {
    cells,
    off,
    to,
    w,
    dist: new Int32Array(id),
    hk: heap(),
    hv: heap(),
  };
}

/* Dijkstra from cell src, with a binary heap in typed arrays. dist is exact
   up to cutoff. Past it, a node holds UNREACHED or an upper bound. The
   result is valid until the next search. */
export function search(g: Reach, src: number, cutoff: number) {
  const { off, to, w, dist, hk, hv } = g;
  dist.fill(UNREACHED);
  dist[src] = 0;
  hk[0] = 0;
  hv[0] = src;
  let len = 1;
  while (len) {
    const d = hk[0];
    const u = hv[0];
    const lk = hk[--len];
    const lv = hv[len];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= len) break;
      if (c + 1 < len && hk[c + 1] < hk[c]) c++;
      if (hk[c] >= lk) break;
      hk[i] = hk[c];
      hv[i] = hv[c];
      i = c;
    }
    hk[i] = lk;
    hv[i] = lv;
    if (d > cutoff) break;
    if (d > dist[u]) continue;
    for (let e = off[u]; e < off[u + 1]; e++) {
      const v = to[e];
      const nd = d + w[e];
      if (nd >= dist[v]) continue;
      dist[v] = nd;
      let j = len++;
      while (j > 0 && hk[(j - 1) >> 1] > nd) {
        hk[j] = hk[(j - 1) >> 1];
        hv[j] = hv[(j - 1) >> 1];
        j = (j - 1) >> 1;
      }
      hk[j] = nd;
      hv[j] = v;
    }
  }
  return dist;
}

/* A baked file of size bytes, unzipped. The dev server sends a .gz file
   with Content-Encoding: gzip, so the browser has already unzipped it.
   Unzip only a file of another size. */
export async function baked(url: string, size: number) {
  const raw = await (await fetch(url)).blob();
  const data =
    raw.size === size
      ? raw
      : new Response(raw.stream().pipeThrough(new DecompressionStream('gzip')));
  return new Uint8Array(await data.arrayBuffer());
}
