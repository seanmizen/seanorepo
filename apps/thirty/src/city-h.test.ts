import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkFixtures, load } from './check.ts';
import { mulberry32 } from './gen.ts';
import { centre, SHAPES } from './net.ts';
import { parse } from './params.ts';

checkFixtures(28, 30);

// An arc follows a circle around the jobs centre, so its stops go around the centre.
// The span is 360 degrees less the largest gap between the stop angles.
test('an arc on London spans 90 degrees or more', () => {
  const p = parse('city=london');
  const city = load(p);
  const [cx, cy] = centre(city);
  const rng = mulberry32(1);
  const spans: number[] = [];
  for (let tries = 0; spans.length < 50 && tries < 1000; tries++) {
    const tier = p.tiers[Math.floor(rng() * p.tiers.length)];
    const l = SHAPES.arc(city, p, rng, tier, new Set());
    if (!l) continue;
    const a = l.stops
      .map(
        (c) =>
          (Math.atan2(Math.floor(c / city.w) - cy, (c % city.w) - cx) * 180) /
          Math.PI,
      )
      .sort((x, y) => x - y);
    let gap = a[0] + 360 - a[a.length - 1];
    for (let k = 1; k < a.length; k++) gap = Math.max(gap, a[k] - a[k - 1]);
    spans.push(360 - gap);
  }
  assert.equal(spans.length, 50);
  assert.ok(Math.max(...spans) >= 90, `largest span ${Math.max(...spans)}`);
});
