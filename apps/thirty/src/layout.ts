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

  // Each path point moves to the corner where the two offset segments on each side meet.
  // An offset of 0 counts, so a line keeps its own direction up to the corner where it
  // joins a bundle. On a straight run with a change of offset, the larger offset wins.
  const pts = lines.map((l, i) =>
    l.path.map((c, k): Pt => {
      const [x, y] = at(c);
      const side = [k - 1, k + 1]
        .filter((j) => j >= 0 && j < l.path.length)
        .map((j) => {
          const s = key(c, l.path[j]);
          const [nx, ny] = raw(c, l.path[j]);
          return [nx, ny, (offset.get(s)?.get(i) ?? 0) * (sign.get(s) ?? 1)];
        });
      if (side.length === 1)
        return [x + side[0][0] * side[0][2], y + side[0][1] * side[0][2]];
      const [[ax, ay, ao], [bx, by, bo]] = side;
      const det = ax * by - ay * bx;
      if (Math.abs(det) > 0.2) {
        // Solve d · nA = oA and d · nB = oB. Limit the length at sharp corners.
        let dx = (ao * by - bo * ay) / det;
        let dy = (ax * bo - bx * ao) / det;
        const m = Math.hypot(dx, dy);
        const lim = 3 * Math.max(Math.abs(ao), Math.abs(bo));
        if (m > lim) [dx, dy] = [(dx * lim) / m, (dy * lim) / m];
        return [x + dx, y + dy];
      }
      const [nx, ny, o] = Math.abs(ao) >= Math.abs(bo) ? side[0] : side[1];
      return [x + nx * o, y + ny * o];
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
