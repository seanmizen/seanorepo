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
