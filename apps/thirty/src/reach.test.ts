import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  graph,
  search,
} from '../../seanmizen.com/src/components/thirty-bg/reach.ts';
import { load } from './check.ts';
import { mulberry32 } from './gen.ts';
import {
  csr,
  dijkstra,
  lineEdges,
  netTimes,
  walkGraph,
  walkTimes,
} from './graph.ts';
import { type Line, SHAPES } from './net.ts';
import { parse } from './params.ts';

// The seanmizen.com background searches the baked walk grid and network in the browser.
// From each source cell, its times up to 30 min must agree with dijkstra() on thirty's own
// walk graph and line edges, to 0.1 min.
test('the browser search agrees with dijkstra() on London', () => {
  const p = parse('city=london');
  const city = load(p);
  const rng = mulberry32(7);
  // A few lines and arcs of each tier, and one loop.
  const lines: Line[] = [];
  const loop = (l: Line) => l.loop && l.stops.length > 2;
  for (let k = 0; k < 5000 && !(lines.length >= 12 && lines.some(loop)); k++) {
    const tier = p.tiers[k % p.tiers.length];
    const l = SHAPES[k % 2 ? 'line' : 'arc'](city, p, rng, tier, new Set());
    if (l && (lines.length < 12 || loop(l))) lines.push(l);
  }
  assert.ok(lines.some(loop));
  const net = { lines };
  const n = city.w * city.w;
  const e = { a: [] as number[], b: [] as number[], w: [] as number[] };
  const add = (a: number, b: number, w: number) => {
    e.a.push(a);
    e.b.push(b);
    e.w.push(w);
  };
  const walk = walkGraph(city);
  for (let u = 0; u < n; u++)
    for (let k = walk.off[u]; k < walk.off[u + 1]; k++)
      add(u, walk.to[k], walk.w[k]);
  const g = csr(
    lineEdges(net, p, (c) => c, n, add),
    e,
  );
  const r = graph(walkTimes(city), netTimes(net, p));
  const N = 300;
  const land = Array.from({ length: 4 }, () => {
    let c = Math.floor(rng() * n);
    while (city.water[c] === 1) c = Math.floor(rng() * n);
    return c;
  });
  const sources = [...lines.slice(0, 4).map((l) => l.stops[1]), ...land];
  for (const src of sources) {
    const want = dijkstra(g, src).dist.slice(0, n);
    const got = search(r, src, N);
    let reached = 0;
    for (let c = 0; c < n; c++)
      if (want[c] <= N) {
        reached++;
        assert.ok(Math.abs(got[c] - want[c]) <= 1, `cell ${c} from ${src}`);
      } else assert.ok(got[c] > N, `cell ${c} from ${src}`);
    assert.ok(reached > 100, `${reached} cells from ${src}`);
  }
});
