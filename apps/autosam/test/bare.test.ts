// Where: apps/autosam, run by `yarn test`.
// When: on each change to public/app.js.
// Why: REQ-BARE-001. The bare theme turns off every page style. A state that
// only a class shows then disappears, and the page loses a function. This
// test finds each class that app.js turns on and off. Each one needs a line
// in CARRIERS that says what shows the same state with no page styles.

import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

// Each state class, and what shows that state with no page styles.
const CARRIERS: Record<string, string> = {
  cur: '<mark> around the chords, and aria-current (markCurrent)',
  cursor: '<mark> around the chords, and aria-current (markCurrent)',
  pending: 'the text "(next)" in the bar (markPending)',
  on: 'the text of the beat dot, ● or ○ (showBeat)',
  lit: 'the beat dots: the ticks of the playing bar show the same beat',
  rh: 'the text of #rhNotes (showKeys)',
  lh: 'the text of #lhNotes (showKeys)',
  looping: 'the Loop checkbox, and the section name in the Now panel',
  armed: 'the button text "Click again to archive"',
  counting: 'the text of #nowChord (the count) and #nowNum ("count-in")',
  inrange: 'the Loop label: "Loop bars a–b" (showRange)',
};

test('each state class in app.js has a carrier with no page styles (REQ-BARE-001)', () => {
  const found = new Set<string>();
  for (const call of app.matchAll(
    /classList\.(?:add|remove|toggle)\(([^)]*)\)/g,
  )) {
    for (const name of call[1].matchAll(/'([a-z0-9-]+)'/g)) found.add(name[1]);
  }
  expect(found.size).toBeGreaterThan(0);
  expect([...found].filter((c) => !(c in CARRIERS))).toEqual([]);
});
