import type { Line } from './net.ts';

export type Pt = [number, number];

// Tube-map layout. Lines that use the same cells run side by side, in the order given.
// Rule: two neighbouring lines touch if they share a station anywhere. Otherwise a gap separates them.
// Each station point sits on the line that stops there, so a line that passes a station shows no stop.
export function layout(
  lines: Line[],
  at: (c: number) => Pt,
  width: (l: Line) => number,
  gap: number,
) {
  const stops = lines.map((l) => new Set(l.stops));
  const share = (i: number, j: number) => {
    for (const c of stops[i]) if (stops[j].has(c)) return true;
    return false;
  };
  const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);

  const bundles = new Map<string, number[]>();
  lines.forEach((l, i) => {
    for (let k = 1; k < l.path.length; k++) {
      const s = key(l.path[k - 1], l.path[k]);
      const b = bundles.get(s) ?? [];
      if (!b.includes(i)) b.push(i);
      bundles.set(s, b);
    }
  });

  // Offset of each line from the segment centre, along the normal of the segment (low cell to high cell).
  const offset = new Map<string, Map<number, number>>();
  for (const [s, ids] of bundles) {
    const m = new Map<number, number>();
    let total = 0;
    ids.forEach((i, j) => {
      if (j > 0 && !share(ids[j - 1], i)) total += gap;
      const w = width(lines[i]);
      m.set(i, total + w / 2);
      total += w;
    });
    for (const [i, o] of m) m.set(i, o - total / 2);
    offset.set(s, m);
  }

  // Orient each segment's normal to agree with the segment before it, on the first line
  // that uses it. Without this, the normal flips at some turns and the bundle twists.
  const raw = (a: number, b: number): Pt => {
    const [ax, ay] = at(Math.min(a, b));
    const [bx, by] = at(Math.max(a, b));
    const len = Math.hypot(bx - ax, by - ay);
    return [-(by - ay) / len, (bx - ax) / len];
  };
  const sign = new Map<string, number>();
  for (const l of lines)
    for (let k = 1; k < l.path.length; k++) {
      const s = key(l.path[k - 1], l.path[k]);
      if (sign.has(s)) continue;
      const [px, py] = k > 1 ? raw(l.path[k - 2], l.path[k - 1]) : [0, 0];
      const [nx, ny] = raw(l.path[k - 1], l.path[k]);
      const before =
        k > 1 ? (sign.get(key(l.path[k - 2], l.path[k - 1])) ?? 1) : 1;
      sign.set(s, (px * nx + py * ny) * before >= 0 ? 1 : -1);
    }

  // Each path point moves by the mean of the offsets of the segments on each side of it.
  const pts = lines.map((l, i) =>
    l.path.map((c, k): Pt => {
      const [x, y] = at(c);
      let dx = 0;
      let dy = 0;
      let m = 0;
      for (const j of [k - 1, k + 1]) {
        if (j < 0 || j >= l.path.length) continue;
        const s = key(c, l.path[j]);
        const [nx, ny] = raw(c, l.path[j]);
        const o = (offset.get(s)?.get(i) ?? 0) * (sign.get(s) ?? 1);
        dx += nx * o;
        dy += ny * o;
        m++;
      }
      return m ? [x + dx / m, y + dy / m] : [x, y];
    }),
  );

  const stations = new Map<number, { i: number; p: Pt }[]>();
  lines.forEach((l, i) => {
    for (const c of l.stops) {
      const s = stations.get(c) ?? [];
      s.push({ i, p: pts[i][l.path.indexOf(c)] });
      stations.set(c, s);
    }
  });
  return { pts, stations };
}
