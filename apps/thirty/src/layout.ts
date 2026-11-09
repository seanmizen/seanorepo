import type { Line } from './net.ts';

export type Pt = [number, number];

// The cells a line draws through on a map w cells wide. Between two stations: straight, then 45°,
// always built from the lower cell index, so all lines between the same two stations share both legs.
// Then one-cell steps, so lines that use the same cells run side by side whatever their stations are.
// A loop draws back to its first stop.
export function tubePath(l: Pick<Line, 'stops' | 'loop'>, w: number) {
  const legs = (a: number, b: number) => {
    const [p, e] = a < b ? [a, b] : [b, a];
    const dx = (e % w) - (p % w);
    const dy = Math.floor(e / w) - Math.floor(p / w);
    const d = Math.min(Math.abs(dx), Math.abs(dy));
    const k = e - Math.sign(dx) * d - Math.sign(dy) * d * w;
    const out = k === p || k === e ? [p, e] : [p, k, e];
    return a < b ? out : out.reverse();
  };
  const cells = (a: number, b: number) => {
    const dx = Math.sign((b % w) - (a % w));
    const dy = Math.sign(Math.floor(b / w) - Math.floor(a / w));
    const out: number[] = [];
    for (let c = a; c !== b; ) {
      c += dx + dy * w;
      out.push(c);
    }
    return out;
  };
  const st = l.loop ? [...l.stops, l.stops[0]] : l.stops;
  return st
    .flatMap((c, k) => (k ? legs(st[k - 1], c).slice(1) : [c]))
    .flatMap((c, k, p) => (k ? cells(p[k - 1], c) : [c]));
}

// Tube-map layout. Each straight run of a line (its cell steps from one corner to the next) has one
// offset from the cell centres, so a line never shifts sideways between corners. Runs are placed
// longest first. A run on free cells gets offset 0. A later run gets the offset nearest 0 that
// clears every placed run on any of its cells. Its side keeps its order against the lines that
// share its placed neighbouring runs, as on the tube map. With no such line, the side it enters
// from decides. Two lines touch if they share a station anywhere. Otherwise a gap separates them.
// An offset is along the normal of the
// step from its low cell to its high cell, so runs in opposite directions on the same cells agree.
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
  const raw = (a: number, b: number): Pt => {
    const [ax, ay] = at(Math.min(a, b));
    const [bx, by] = at(Math.max(a, b));
    const len = Math.hypot(bx - ax, by - ay);
    return [-(by - ay) / len, (bx - ax) / len];
  };

  // Runs as path indices: line i goes straight from path[a] to path[b].
  const runs: { i: number; a: number; b: number }[] = [];
  lines.forEach(({ path: p }, i) => {
    for (let a = 0, k = 1; k < p.length; k++)
      if (k === p.length - 1 || p[k + 1] - p[k] !== p[k] - p[k - 1]) {
        runs.push({ i, a, b: k });
        a = k;
      }
  });
  // off[i][k] is the offset of line i on the step from path[k - 1] to path[k].
  const off = lines.map((l) => l.path.map(() => 0));
  const done = lines.map((l) => l.path.map(() => false));
  // The lines on each cell step.
  const users = new Map<string, Set<number>>();
  lines.forEach(({ path: p }, i) => {
    for (let k = 1; k < p.length; k++)
      users.set(
        key(p[k - 1], p[k]),
        (users.get(key(p[k - 1], p[k])) ?? new Set()).add(i),
      );
  });
  const placed = new Map<string, { i: number; o: number }[]>();
  runs.sort((x, y) => y.b - y.a - (x.b - x.a));
  for (const { i, a, b } of runs) {
    const p = lines[i].path;
    // A run that goes back over its own line keeps that offset, so an out-and-back is one stroke.
    let own: number | undefined;
    const clear: Pt[] = [];
    for (let k = a + 1; k <= b; k++)
      for (const q of placed.get(key(p[k - 1], p[k])) ?? []) {
        if (q.i === i) own = q.o;
        else
          clear.push([
            q.o,
            (width(lines[i]) + width(lines[q.i])) / 2 +
              (share(i, q.i) ? 0 : gap),
          ]);
      }
    const [nx, ny] = raw(p[a], p[a + 1]);
    const [x, y] = at(p[a]);
    const [px, py] = a > 0 ? at(p[a - 1]) : [x, y];
    const side = (px - x) * nx + (py - y) * ny < 0 ? -1 : 1;
    // Lines that share this run and the nearest placed step of this line before or after it,
    // and every step between, keep their order (left or right of travel) through the corners.
    // Each entry [q, s, g] asks for (q - o) * s > 0, and better (q - o) * s >= g, the space
    // between the two lines on the placed step, so lines placed later still fit between them.
    const order: number[][] = [];
    const step = (k: number) => key(p[k - 1], p[k]);
    const turn = (k: number) => Math.sign(p[k] - p[k - 1]);
    for (const [k2, d] of [
      [a + 1, -1],
      [b, 1],
    ]) {
      let k1 = k2 + d;
      while (k1 > 0 && k1 < p.length && !done[i][k1]) k1 += d;
      if (k1 <= 0 || k1 >= p.length) continue;
      for (const q of placed.get(step(k1)) ?? []) {
        const r = placed.get(step(k2))?.find((z) => z.i === q.i);
        let along = q.i !== i && r !== undefined;
        for (let k = k1 - d; along && k !== k2; k -= d)
          along = users.get(step(k))?.has(q.i) === true;
        if (r && along)
          order.push([
            r.o,
            Math.sign(q.o - off[i][k1]) * turn(k1) * turn(k2),
            Math.abs(q.o - off[i][k1]),
          ]);
      }
    }
    // The side it enters from decides only when no order is at stake.
    const cost = (v: number) =>
      4 * order.filter(([q, s]) => (q - v) * s <= 0).length +
      2 * order.filter(([q, s, g]) => (q - v) * s < g - 1e-9).length +
      (v * side < 0 ? 1 : 0);
    const o =
      own ??
      [
        0,
        ...clear.flatMap(([q, c]) => [q - c, q + c]),
        ...order.map(([q, s, g]) => q - s * g),
      ]
        .filter((v) => clear.every(([q, c]) => Math.abs(v - q) > c - 1e-9))
        .sort((u, v) => cost(u) - cost(v) || Math.abs(u) - Math.abs(v))[0];
    for (let k = a + 1; k <= b; k++) {
      done[i][k] = true;
      off[i][k] = o;
      const list = placed.get(key(p[k - 1], p[k])) ?? [];
      list.push({ i, o });
      placed.set(key(p[k - 1], p[k]), list);
    }
  }

  // Each path point moves to the corner where the two offset steps on each side meet.
  // A loop closes at its first point, so there the steps on each side are its last and first.
  const pts = lines.map((l, i) =>
    l.path.map((c, k): Pt => {
      const [x, y] = at(c);
      const n = l.path.length;
      const ends = l.loop && (k === 0 || k === n - 1);
      const side = (ends ? [n - 1, 1] : [k, k + 1])
        .filter((j) => j > 0 && j < n)
        .map((j) => [...raw(l.path[j - 1], l.path[j]), off[i][j]]);
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
