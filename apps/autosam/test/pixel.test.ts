// Where: apps/autosam, run by `yarn test`.
// When: on each change to public/pixel.css.
// Why: REQ-PIXEL. Pixel-1 covers the smallest area that still shows
// everything. This test checks the constraints that the CSS alone can show.

import { expect, test } from 'bun:test';
import { type Decl, declarations, readCss } from './css';

const css = readCss('pixel.css');
const decls = declarations(css);
const show = (d: Decl) => `${d.selector} { ${d.prop}: ${d.value} }`;

test('pixel.css parses: its braces balance, and it has declarations', () => {
  expect(css.split('{').length).toBe(css.split('}').length);
  expect(decls.length).toBeGreaterThan(100);
});

test('pixel.css has no space larger than 1px (REQ-PIXEL-001)', () => {
  const bad = decls.filter(
    (d) =>
      /^(padding|margin|gap|row-gap|column-gap)(-[a-z]+)?$/.test(d.prop) &&
      d.value.split(/\s+/).some((v) => !/^(0|1px)$/.test(v)),
  );
  expect(bad.map(show)).toEqual([]);
});

test('pixel.css centres nothing and stretches nothing (REQ-PIXEL-001)', () => {
  const bad = decls.filter(
    (d) =>
      (/^margin(-inline|-left|-right)?$/.test(d.prop) &&
        /\bauto\b/.test(d.value)) ||
      (/^(justify-content|place-content|place-items|justify-items)$/.test(
        d.prop,
      ) &&
        /center|stretch/.test(d.value)) ||
      (d.prop === 'flex-grow' && d.value !== '0'),
  );
  expect(bad.map(show)).toEqual([]);
});

test('pixel.css sets all text at one size (REQ-PIXEL-002)', () => {
  // 9px on the root. 1rem brings text back to it. 0 hides a text node that
  // CSS cannot select, beside an element that shows.
  const bad = decls.filter(
    (d) =>
      d.prop === 'font-size' &&
      !(d.selector === '&' && d.value === '9px') &&
      !['1rem', '0'].includes(d.value),
  );
  expect(bad.map(show)).toEqual([]);
});

test('pixel.css draws no border, shadow, radius or gradient (REQ-PIXEL-003)', () => {
  const bad = decls.filter(
    (d) =>
      (/^border(-(top|right|bottom|left|width|style|color))?$/.test(d.prop) &&
        !/^(0|none)$/.test(d.value)) ||
      (/radius$/.test(d.prop) && d.value !== '0') ||
      (/shadow$/.test(d.prop) && d.value !== 'none') ||
      /gradient\(/.test(d.value),
  );
  expect(bad.map(show)).toEqual([]);
});

test('pixel.css keeps touch targets 24px high (REQ-PIXEL-004)', () => {
  const coarse = /@media \(pointer: coarse\) \{([^}]*)\{([^}]*)\}/.exec(css);
  expect(coarse).not.toBeNull();
  const [, selector, body] = coarse as RegExpExecArray;
  for (const target of ['button', 'summary', '.seg label', '.chip'])
    expect(selector).toContain(target);
  expect(body).toContain('min-height: 24px');
});
