// Where: apps/autosam/test, imported by the CSS tests.
// When: each test file that checks a theme stylesheet.
// Why: REQ-DENSE and REQ-PIXEL are constraints on CSS. These helpers read a
// stylesheet and list its declarations, so a test can check each one.

import { readFileSync } from 'node:fs';

export type Decl = { selector: string; prop: string; value: string };

// The text of public/<name>, with no comments.
export const readCss = (name: string) =>
  readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );

// Each declaration, with the selector of the innermost rule around it. An
// at-rule (@media, @container) is not a selector, so it is skipped.
export function declarations(text: string): Decl[] {
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
