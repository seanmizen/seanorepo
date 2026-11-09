import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkFixtures, result, shared } from './check.ts';

checkFixtures(25, 27);

// London with station prices and snapped stops. More lines share a station than in fixture 23.
test('26 has more shared stations than 23', () => {
  const n = (i: number) => {
    const { snaps } = result(i);
    return shared(snaps[snaps.length - 1].net);
  };
  assert.ok(n(25) > n(22), `${n(25)} <= ${n(22)}`);
});
