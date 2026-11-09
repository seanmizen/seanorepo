// Where: apps/thirty. When: after a build, against a running server.
// Why: loads each fixture URL in headless Chrome. Fails on a console error, a page error, a timeout,
// or a hash that is not the pinned hash. Then London greedy with gpu=0 and gpu=1: the hashes must be
// the same, and gpu=1 fails if the page has no WebGPU adapter. Fixture 7 (30 greedy steps) must put
// each step on the slider: steps 0 to 30.
// Usage: node scripts/check-urls.mjs [base URL, default http://localhost:4110/]
import puppeteer from 'puppeteer';
import { FIXTURES, HASHES } from '../src/fixtures.ts';

const base = process.argv[2] ?? 'http://localhost:4110/';
const GPU = [0, 1].map((g) => `${FIXTURES[22]}&gpu=${g}`);
const browser = await puppeteer.launch({ args: ['--enable-unsafe-webgpu'] });
const results = await Promise.all(
  [...FIXTURES, ...GPU].map(async (qs, i) => {
    const page = await browser.newPage();
    const errs = [];
    page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(`${base}?${qs}`);
    await page
      .waitForSelector('body[data-done]', { timeout: 300000 })
      .catch(() => errs.push('Timeout.'));
    const { done = '', gpu } = await page.$eval('body', (b) => ({
      ...b.dataset,
    }));
    const max = await page.$eval('#t', (t) => t.max);
    await page.close();
    if (HASHES[i] && done !== HASHES[i]) errs.push(`Hash is not ${HASHES[i]}.`);
    if (qs.endsWith('gpu=1') && gpu !== '1') errs.push('No WebGPU adapter.');
    if (i === 6 && max !== '30') errs.push(`Slider has steps 0 to ${max}.`);
    return {
      done,
      line: `${errs.length ? 'FAIL' : 'ok  '} ${String(i + 1).padStart(2)} ${done} ${qs}${errs.map((e) => `\n     ${e}`).join('')}`,
    };
  }),
);
await browser.close();
const [cpu, gpu] = results.slice(-2);
if (cpu.done !== gpu.done)
  results.push({ line: 'FAIL gpu=0 and gpu=1 give different hashes.' });
console.log(results.map((r) => r.line).join('\n'));
process.exit(results.some((r) => r.line.startsWith('FAIL')) ? 1 : 0);
