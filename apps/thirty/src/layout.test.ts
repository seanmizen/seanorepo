import assert from 'node:assert/strict';
import { test } from 'node:test';
import { load, result } from './check.ts';
import { FIXTURES } from './fixtures.ts';
import { layout, type Pt, tubePath } from './layout.ts';
import type { Line } from './net.ts';
import { parse } from './params.ts';

// Tube-map rule: every drawn segment, the closing segment of a loop too, is horizontal, vertical or at 45°, within 1°.
// Cells are 10 units wide and lines 1 unit, as when the map is zoomed in.
for (const i of [22, 27, 28])
  test(`${i + 1}: every segment is at a multiple of 45°`, () => {
    const { snaps } = result(i);
    const { w } = load(parse(FIXTURES[i]));
    const lines = snaps[snaps.length - 1].net.lines.map((l) => ({
      ...l,
      path: tubePath(l, w),
    }));
    const at = (c: number): Pt => [
      ((c % w) + 0.5) * 10,
      (Math.floor(c / w) + 0.5) * 10,
    ];
    const { pts } = layout(lines, at, () => 1, 0.6);
    const bad: string[] = [];
    pts.forEach((all, j) => {
      // A loop also draws from its last point back to its first.
      const q = lines[j].loop ? [...all, all[0]] : all;
      for (let k = 1; k < q.length; k++) {
        const [dx, dy] = [q[k][0] - q[k - 1][0], q[k][1] - q[k - 1][1]];
        if (Math.hypot(dx, dy) < 1e-6) continue;
        const a = ((((Math.atan2(dy, dx) * 180) / Math.PI) % 45) + 45) % 45;
        if (Math.min(a, 45 - a) > 1)
          bad.push(`line ${j} point ${k}: ${a.toFixed(1)}°`);
      }
    });
    assert.deepEqual(bad.slice(0, 10), [], `${bad.length} slanted segments`);
  });

// One long line across a map 20 cells wide, on row 10. Two lines join it from above for part of
// the way, and one from below further on. The long line stays dead straight at offset 0. Each
// joiner sits on its own side, and the second joiner from above goes one place further out.
test('joiners sit beside a straight line on the side they enter from', () => {
  const line = (path: number[]): Line => ({
    tier: 'tube',
    shape: 'line',
    loop: false,
    path,
    stops: [path[0], path[path.length - 1]],
    segs: [],
    cost: 0,
  });
  const row = (a: number, b: number) =>
    Array.from({ length: b - a + 1 }, (_, k) => 200 + a + k);
  const lines = [
    line(row(0, 19)),
    line([162, 183, ...row(4, 9)]),
    line([143, 164, 185, ...row(6, 8)]),
    line([271, 252, 233, ...row(14, 17)]),
  ];
  const at = (c: number): Pt => [
    ((c % 20) + 0.5) * 10,
    (Math.floor(c / 20) + 0.5) * 10,
  ];
  const { pts } = layout(lines, at, () => 1, 0.6);
  const ys = (j: number, from: number) =>
    [...new Set(pts[j].slice(from).map((p) => p[1].toFixed(6)))].map(Number);
  assert.deepEqual(ys(0, 0), [105]);
  assert.deepEqual(ys(1, 2), [103.4]);
  assert.deepEqual(ys(2, 3), [101.8]);
  assert.deepEqual(ys(3, 3), [106.6]);
});

// The final lines of fixture i, laid out as the page draws them by tier at zoom k: a canvas
// 1600 pixels wide at devicePixelRatio 2. At the lowest zoom, 0.25, a line is wider than a cell.
const WIDE: Record<string, number> = {
  express: 5,
  rer: 3.5,
  tube: 2.5,
  tram: 1.5,
};
function drawn(i: number, k: number) {
  const { snaps } = result(i);
  const { w } = load(parse(FIXTURES[i]));
  const lines = snaps[snaps.length - 1].net.lines.map((l) => ({
    ...l,
    path: tubePath(l, w),
  }));
  const lw = 2 / Math.sqrt(k);
  const at = (c: number): Pt => [
    ((c % w) + 0.5) * (1600 / w),
    (Math.floor(c / w) + 0.5) * (1600 / w),
  ];
  const width = (l: Line) => WIDE[l.tier] * lw;
  return { lines, at, ...layout(lines, at, width, 0.6 * 2.5 * lw) };
}

// The distance of point q to the left of the line through the cells a and b, in travel order.
const left = (at: (c: number) => Pt, a: number, b: number, q: Pt) => {
  const [[ax, ay], [bx, by]] = [at(a), at(b)];
  return (
    ((bx - ax) * (q[1] - ay) - (by - ay) * (q[0] - ax)) /
    Math.hypot(bx - ax, by - ay)
  );
};

// Each drawn segment keeps one offset from its cell step, so a corner point lies on both of
// its legs. A corner point off a leg makes the stroke step out and back: a stub at the corner.
for (const i of [22, 27, 28])
  for (const k of [4, 0.25])
    test(`${i + 1}: every corner lies on both of its legs at zoom ${k}`, () => {
      const { lines, at, pts } = drawn(i, k);
      const bad: string[] = [];
      lines.forEach(({ path: p }, j) => {
        for (let s = 1; s < p.length; s++) {
          const d =
            left(at, p[s - 1], p[s], pts[j][s - 1]) -
            left(at, p[s - 1], p[s], pts[j][s]);
          if (Math.abs(d) > 1e-6)
            bad.push(`line ${j} step ${s}: ${d.toFixed(2)}`);
        }
      });
      assert.deepEqual(
        bad.slice(0, 10),
        [],
        `${bad.length} steps off their offset`,
      );
    });

// Lines that share a run and the next run through the same corner keep their order, left or
// right of travel, as on the tube map. Otherwise they cross at the corner.
for (const i of [22, 27, 28])
  test(`${i + 1}: lines keep their order through each shared corner`, () => {
    const { lines, at, pts } = drawn(i, 4);
    const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
    const mid = (j: number, s: number): Pt => [
      (pts[j][s - 1][0] + pts[j][s][0]) / 2,
      (pts[j][s - 1][1] + pts[j][s][1]) / 2,
    ];
    // Each corner of each line: its two cell steps, and the index of the step after it.
    const corners = lines.map(({ path: p }) => {
      const out = new Map<string, number>();
      for (let s = 1; s < p.length - 1; s++)
        if (p[s + 1] - p[s] !== p[s] - p[s - 1])
          out.set(
            [key(p[s - 1], p[s]), key(p[s], p[s + 1])].sort().join('|'),
            s + 1,
          );
      return out;
    });
    const bad: string[] = [];
    lines.forEach(({ path: p }, x) => {
      for (const [c, s] of corners[x])
        for (let j = x + 1; j < lines.length; j++) {
          const t = corners[j].get(c);
          if (t === undefined) continue;
          // Line j's steps on the same two runs, in line i's travel order.
          const q = lines[j].path;
          const [u, v] =
            key(q[t - 2], q[t - 1]) === key(p[s - 2], p[s - 1])
              ? [t - 1, t]
              : [t, t - 1];
          const before =
            left(at, p[s - 2], p[s - 1], mid(j, u)) -
            left(at, p[s - 2], p[s - 1], mid(x, s - 1));
          const after =
            left(at, p[s - 1], p[s], mid(j, v)) -
            left(at, p[s - 1], p[s], mid(x, s));
          if (Math.sign(before) !== Math.sign(after))
            bad.push(`lines ${x}, ${j} at cell ${p[s - 1]}`);
        }
    });
    assert.deepEqual(bad.slice(0, 10), [], `${bad.length} swaps`);
  });
