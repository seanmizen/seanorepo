import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkFixtures, result } from './check.ts';

checkFixtures(30, 32);

// With revenue, J is the profit. Greedy adds a line only if the profit rises.
test('31: greedy never lowers the profit and adds no line that does not pay', () => {
  const { snaps } = result(30);
  for (let k = 1; k < snaps.length; k++) {
    if (snaps[k].algo !== 'greedy') continue;
    const [a, b] = [snaps[k - 1], snaps[k]];
    assert.ok(b.J >= a.J, `profit fell at step ${k}`);
    if (b.net.lines.length > a.net.lines.length)
      assert.ok(b.J > a.J, `line with no gain at step ${k}`);
  }
});
