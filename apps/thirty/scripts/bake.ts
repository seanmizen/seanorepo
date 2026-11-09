// Where: apps/thirty. When: `yarn thirty:bake` at the repo root, after a change to the simulation.
// Why: the seanmizen.com background plays back thirty cities. A visitor's device must not run the
// simulation, so this script runs each URL in bake.json once and writes the result into
// apps/seanmizen.com/public/thirty: {n}.bin.gz and index.json.
// Each city file is gzipped. It starts with 256 x 256 texels of RG8. A texel shows the city cell under it.
// R: unmet demand at step 0, as sqrt(unmet / most) x 255, so a dot's area follows the demand.
// most is the 99th percentile of the cells with demand. R is at most 255.
// G: the step at which the unmet demand of the cell falls below half of its start value. 255: never.
// Then the lines of the last step, as Uint16 values: for each line, the step at which it appears,
// its point count n, then n points x, y. A point is in the tube-map layout, from 0 to 65535 across
// the square city. Then, from byte `graph`, the network for the browser search: netTimes() in
// src/graph.ts. index.json gives `graph` and the unzipped size in bytes.
// All cities on one map share one walk file, walk-{city}.bin.gz: walkTimes() in src/graph.ts, as
// Uint16 values. Its unzipped size is 8 bytes for each cell.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fromBytes, genCity } from '../src/gen.ts';
import { evaluate, netTimes, walkTimes } from '../src/graph.ts';
import { layout, type Pt, tubePath } from '../src/layout.ts';
import { type Line, run, type Snap } from '../src/net.ts';
import { parse } from '../src/params.ts';

const T = 256; // Texels on a side.
const S = 256; // Job samples in each score, the same as the page's display snapshot.
const SIDE = 400; // One line width on the tube map is 1 / SIDE of the city side.
const out = new URL('../../seanmizen.com/public/thirty/', import.meta.url);
const urls: string[] = JSON.parse(
  readFileSync(new URL('../bake.json', import.meta.url), 'utf8'),
);
mkdirSync(out, { recursive: true });

const key = (l: Line) => `${l.tier}:${l.stops.join(',')}`;
let bytes = 0;
// The output is the same bytes on each run: a fixed gzip level and a fixed gzip header.
const write = (name: string, raw: Uint8Array) => {
  const gz = gzipSync(raw, { level: 9 });
  gz[9] = 255; // The OS byte of the header: unknown, so each machine writes the same bytes.
  writeFileSync(new URL(name, out), gz);
  bytes += gz.length;
  return gz.length;
};
const walks = new Set<string>();
const index = urls.map((qs, n) => {
  const p = parse(qs);
  // A real city loads from public/cities. The page that shows it credits its data.
  const city = p.city
    ? fromBytes(
        new Uint8Array(
          readFileSync(
            new URL(`../public/cities/${p.city}.bin`, import.meta.url),
          ),
        ).buffer,
        p.city,
      )
    : genCity(p);
  const { w } = city;
  if (w > 256) throw new Error('A cell must fit in a Uint16 value.');
  const walk = `walk-${p.city || n}.bin.gz`;
  if (!walks.has(walk)) {
    const wt = walkTimes(city);
    console.log(`${walk} ${write(walk, new Uint8Array(wt.buffer))} bytes`);
    walks.add(walk);
  }
  const snaps = [...run(city, p)].filter((s): s is Snap => !Array.isArray(s));
  const steps = snaps.length - 1;
  if (steps > 254) throw new Error(`Use at most 254 steps, not ${steps}.`);

  // The unmet demand of each cell at each step, as the unmet layer of the thirty page.
  const unmet = snaps.map((s) => {
    const { score } = evaluate(city, s.net, p, S);
    const top =
      p.goal === 'revenue' ? score.reduce((m, x) => Math.max(m, x), 1e-12) : 1;
    return city.pop.map(
      (h, i) => (h + city.jobs[i]) * Math.max(0, 1 - score[i] / top),
    );
  });
  // A few cells have far more demand than the rest. Scale to the 99th percentile, so most dots show.
  const want = unmet[0].filter((x) => x > 0).sort();
  const most = want[Math.floor(0.99 * (want.length - 1))] ?? 1;
  const half = unmet[0].map((u0, i) => {
    const k = unmet.findIndex((u) => u[i] < u0 / 2);
    return k < 0 ? 255 : k;
  });

  // The lines of the last step. Each appears at the first step from which it is in every later step.
  const last = snaps[steps].net.lines;
  const has = snaps.map((s) => new Set(s.net.lines.map(key)));
  const appear = last.map((l) => {
    let k = steps;
    while (k > 0 && has[k - 1].has(key(l))) k--;
    return k;
  });
  // The layout is in units of the city side, so a point is in 0 to 1.
  const at = (c: number): Pt => [
    ((c % w) + 0.5) / w,
    (Math.floor(c / w) + 0.5) / w,
  ];
  const { pts } = layout(
    last.map((l) => ({ ...l, path: tubePath(l, w) })),
    at,
    () => 1 / SIDE,
    0.6 / SIDE,
  );

  const f = T / w; // Texels per cell.
  const tex = new Uint8Array(T * T * 2);
  for (let i = 0; i < T * T; i++) {
    const c =
      Math.floor((Math.floor(i / T) + 0.5) / f) * w +
      Math.floor(((i % T) + 0.5) / f);
    tex[2 * i] = Math.round(255 * Math.min(1, Math.sqrt(unmet[0][c] / most)));
    tex[2 * i + 1] = half[c];
  }
  // Keep only the corners: remove a point at the same place as the one before it, and a point
  // where the line goes straight on. Keep the tip where a line turns back on itself.
  const q16 = (v: number) => Math.round(65535 * Math.min(1, Math.max(0, v)));
  const lines = pts.flatMap((q, j) => {
    const p = q
      .map(([x, y]) => [q16(x), q16(y)])
      .filter(([x, y], k, a) => !k || x !== a[k - 1][0] || y !== a[k - 1][1]);
    const keep = p.filter(([x, y], k) => {
      if (k === 0 || k === p.length - 1) return true;
      const [ax, ay] = [x - p[k - 1][0], y - p[k - 1][1]];
      const [bx, by] = [p[k + 1][0] - x, p[k + 1][1] - y];
      const cross = Math.abs(ax * by - ay * bx) / Math.hypot(bx, by);
      return cross > 1 || ax * bx + ay * by <= 0;
    });
    return keep.length < 2 ? [] : [appear[j], keep.length, ...keep.flat()];
  });
  const words = [...lines, ...netTimes(snaps[steps].net, p)];
  const raw = new Uint8Array(tex.length + 2 * words.length);
  raw.set(tex);
  const view = new DataView(raw.buffer);
  for (const [k, v] of words.entries())
    view.setUint16(tex.length + 2 * k, v, true);

  const size = write(`${n}.bin.gz`, raw);
  console.log(
    `${n}.bin.gz ${size} bytes, ${steps} steps, ${last.length} lines, ${words.length} values: ${qs}`,
  );
  return {
    file: `${n}.bin.gz`,
    url: qs,
    size: w,
    steps,
    bytes: raw.length,
    graph: tex.length + 2 * lines.length,
    walk,
  };
});
writeFileSync(
  new URL('index.json', out),
  `${JSON.stringify(index, null, 2)}\n`,
);
console.log(`${index.length} cities, ${bytes} bytes.`);
