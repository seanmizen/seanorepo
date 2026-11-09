// Where: apps/thirty. When: `yarn thirty:bake` at the repo root, after a change to the simulation.
// Why: the seanmizen.com background plays back thirty cities. A visitor's device must not run the
// simulation, so this script runs each URL in bake.json once and writes the result into
// apps/seanmizen.com/public/thirty: {n}.bin.gz and index.json.
// Each city is 256 x 256 texels of RGBA8, gzipped. A texel shows the city cell under it.
// R: unmet demand at step 0, as sqrt(unmet / most) x 255, so a dot's area follows the demand.
// most is the 99th percentile of the cells with demand. R is at most 255.
// G: the step at which the unmet demand of the cell falls below half of its start value. 255: never.
// B: distance from the texel centre to the nearest drawn line, in texels, x 255 / RANGE.
// A: the step at which that line appears. 255: no line within RANGE.
// The output is the same bytes on each run: a fixed gzip level and a fixed gzip header.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { genCity } from '../src/gen.ts';
import { evaluate } from '../src/graph.ts';
import { layout, type Pt, tubePath } from '../src/layout.ts';
import { type Line, run, type Snap } from '../src/net.ts';
import { parse } from '../src/params.ts';

const T = 256; // Texels on a side.
const S = 256; // Job samples in each score, the same as the page's display snapshot.
const RANGE = 4; // The largest distance in B, in texels.
const out = new URL('../../seanmizen.com/public/thirty/', import.meta.url);
const urls: string[] = JSON.parse(
  readFileSync(new URL('../bake.json', import.meta.url), 'utf8'),
);
mkdirSync(out, { recursive: true });

const key = (l: Line) => `${l.tier}:${l.stops.join(',')}`;
let bytes = 0;
const index = urls.map((qs, n) => {
  const p = parse(qs);
  if (p.city) throw new Error(`Use a generated city, not ${qs}.`);
  const city = genCity(p);
  const { w } = city;
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
  const f = T / w; // Texels per cell.
  const at = (c: number): Pt => [
    ((c % w) + 0.5) * f,
    (Math.floor(c / w) + 0.5) * f,
  ];
  // One line width, in texels. The texture cannot show two lines less than about 2 texels apart,
  // so lines that share cells draw as one bundle, a little wider than one line.
  const u = 0.08;
  const { pts } = layout(
    last.map((l) => ({ ...l, path: tubePath(l, w) })),
    at,
    () => u,
    0.6 * u,
  );

  const px = new Uint8Array(T * T * 4);
  const dist = new Float32Array(T * T).fill(RANGE);
  for (let i = 0; i < T * T; i++) {
    const c =
      Math.floor((Math.floor(i / T) + 0.5) / f) * w +
      Math.floor(((i % T) + 0.5) / f);
    px.set(
      [
        Math.round(255 * Math.min(1, Math.sqrt(unmet[0][c] / most))),
        half[c],
        255,
        255,
      ],
      4 * i,
    );
  }
  pts.forEach((q, j) => {
    for (let k = 1; k < q.length; k++) {
      const [[ax, ay], [bx, by]] = [q[k - 1], q[k]];
      const len2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
      const lo = (a: number, b: number) =>
        Math.max(0, Math.floor(Math.min(a, b) - RANGE));
      const hi = (a: number, b: number) =>
        Math.min(T - 1, Math.ceil(Math.max(a, b) + RANGE));
      for (let y = lo(ay, by); y <= hi(ay, by); y++)
        for (let x = lo(ax, bx); x <= hi(ax, bx); x++) {
          const [cx, cy] = [x + 0.5, y + 0.5];
          const t = Math.min(
            1,
            Math.max(0, ((cx - ax) * (bx - ax) + (cy - ay) * (by - ay)) / len2),
          );
          const d = Math.hypot(
            ax + t * (bx - ax) - cx,
            ay + t * (by - ay) - cy,
          );
          const i = y * T + x;
          if (d >= dist[i]) continue;
          dist[i] = d;
          px[4 * i + 2] = Math.round((255 * d) / RANGE);
          px[4 * i + 3] = appear[j];
        }
    }
  });

  const gz = gzipSync(px, { level: 9 });
  gz[9] = 255; // The OS byte of the header: unknown, so each machine writes the same bytes.
  writeFileSync(new URL(`${n}.bin.gz`, out), gz);
  bytes += gz.length;
  console.log(
    `${n}.bin.gz ${gz.length} bytes, ${steps} steps, ${last.length} lines: ${qs}`,
  );
  return { file: `${n}.bin.gz`, url: qs, size: w, steps };
});
writeFileSync(
  new URL('index.json', out),
  `${JSON.stringify(index, null, 2)}\n`,
);
console.log(`${index.length} cities, ${bytes} bytes.`);
