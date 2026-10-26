// Where: apps/autosam, run by `yarn test`.
// When: on each change to public/dense.css.
// Why: REQ-DENSE. The dense theme keeps to written constraints. This test
// reads each declaration of dense.css, with the selector of its rule, and
// checks the constraints that the CSS alone can show.

import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const css = readFileSync(
  new URL('../public/dense.css', import.meta.url),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

type Decl = { selector: string; prop: string; value: string };

// Each declaration, with the selector of the innermost rule around it. An
// at-rule (@media, @container) is not a selector, so it is skipped.
function declarations(text: string): Decl[] {
  const out: Decl[] = [];
  const stack: string[] = [];
  let buf = '';
  for (const ch of text) {
    if (ch === '{') {
      stack.push(buf.trim());
      buf = '';
    } else if (ch === '}' || ch === ';') {
      const m = /^([a-z-]+)\s*:\s*([\s\S]+)$/.exec(buf.trim());
      if (m) {
        const selector =
          [...stack].reverse().find((s) => !s.startsWith('@')) ?? '';
        out.push({ selector, prop: m[1], value: m[2].trim() });
      }
      buf = '';
      if (ch === '}') stack.pop();
    } else buf += ch;
  }
  return out;
}

const decls = declarations(css);
const show = (d: Decl) => `${d.selector} { ${d.prop}: ${d.value} }`;

test('dense.css parses: its braces balance, and it has declarations', () => {
  expect(css.split('{').length).toBe(css.split('}').length);
  expect(decls.length).toBeGreaterThan(100);
});

test('dense.css centres nothing and limits no width (REQ-DENSE-001)', () => {
  const bad = decls.filter(
    (d) =>
      (/^margin(-inline|-left|-right)?$/.test(d.prop) &&
        /\bauto\b/.test(d.value)) ||
      (/^(justify-content|place-content|place-items|justify-items)$/.test(
        d.prop,
      ) &&
        d.value === 'center') ||
      d.prop === 'max-width',
  );
  expect(bad.map(show)).toEqual([]);
});

test('dense.css draws no border, shadow, radius or gradient (REQ-DENSE-003)', () => {
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

test('dense.css has no space larger than 0.5em (REQ-DENSE-004)', () => {
  const tooBig = (len: string) => {
    const m = /^(-?[\d.]+)(px|em|rem)?$/.exec(len);
    if (!m) return true;
    const n = Math.abs(Number(m[1]));
    return m[2] === 'px' ? n > 1 : n > 0.5;
  };
  const bad = decls.filter(
    (d) =>
      /^(padding|margin|gap|row-gap|column-gap)(-[a-z]+)?$/.test(d.prop) &&
      d.value.split(/\s+/).some(tooBig),
  );
  expect(bad.map(show)).toEqual([]);
});

test('dense.css keeps touch targets 24px high (REQ-DENSE-006)', () => {
  const coarse = /@media \(pointer: coarse\) \{([^}]*)\{([^}]*)\}/.exec(css);
  expect(coarse).not.toBeNull();
  const [, selector, body] = coarse as RegExpExecArray;
  for (const target of ['button', 'summary', '.seg label', '.chip'])
    expect(selector).toContain(target);
  expect(body).toContain('min-height: 24px');
});
