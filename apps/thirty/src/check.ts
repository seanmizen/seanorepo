import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DIFFERENT, FIXTURES } from './fixtures.ts';
import { fromBytes, genCity } from './gen.ts';
import { hashNet, run, type Snap, spent } from './net.ts';
import { type Params, parse } from './params.ts';

const load = (p: Params) =>
  p.city
    ? fromBytes(
        new Uint8Array(
          readFileSync(
            new URL(`../public/cities/${p.city}.bin`, import.meta.url),
          ),
        ).buffer,
        p.city,
      )
    : genCity(p);

const cache = new Map<string, { hash: string; snaps: Snap[] }>();
function finish(qs: string) {
  const p = parse(qs);
  const snaps = [...run(load(p), p)];
  return { p, snaps, hash: hashNet(snaps[snaps.length - 1].net) };
}

// Tests for fixtures [from, to). One file per city, so node runs the cities in parallel.
export function checkFixtures(from: number, to: number) {
  for (let i = from; i < to; i++) {
    const qs = FIXTURES[i];
    test(`${i + 1}: ${qs}`, () => {
      const r = finish(qs);
      cache.set(qs, r);
      const { p, snaps } = r;
      const last = snaps[snaps.length - 1];
      if (!p.chain.length && !p.city) {
        const city = load(p);
        const wet =
          city.water.reduce((s, x) => s + (x ? 1 : 0), 0) / city.water.length;
        assert.ok(wet >= p.sea - 0.01 && wet <= p.sea + 0.1, `water ${wet}`);
        assert.ok(city.pop.some((x) => x > 0) && city.jobs.some((x) => x > 0));
      }
      assert.equal(last.step, last.total);
      assert.ok(spent(last.net) <= p.budget + 1e-9, 'over budget');
      for (let k = 1; k < snaps.length; k++)
        if (snaps[k].algo === 'greedy')
          assert.ok(snaps[k].J >= snaps[k - 1].J, `greedy fell at step ${k}`);
      let start = 0;
      for (let k = 1; k < snaps.length; k++) {
        if (snaps[k].algo !== snaps[k - 1].algo) start = k - 1;
        const end =
          k === snaps.length - 1 || snaps[k + 1].algo !== snaps[k].algo;
        if (end && snaps[k].algo === 'anneal')
          assert.ok(snaps[k].J >= snaps[start].J, 'anneal ended lower');
      }
      if (p.chain.some(([a]) => a === 'greedy'))
        assert.ok(last.J > snaps[0].J, 'no gain over walking');
      assert.equal(finish(qs).hash, r.hash, 'not deterministic');
    });
  }
  for (const [a, b] of DIFFERENT)
    if (a >= from && a < to && b < to)
      test(`${a + 1} and ${b + 1} differ`, () => {
        const h = (i: number) =>
          (cache.get(FIXTURES[i]) ?? finish(FIXTURES[i])).hash;
        assert.notEqual(h(a), h(b));
      });
}
