// Where: apps/thirty. When: after a build, against a running server.
// Why: loads each fixture URL in headless Chrome. Fails on a console error, a page error or a timeout.
// Usage: node scripts/check-urls.mjs [base URL, default http://localhost:4110/]
import puppeteer from 'puppeteer';
import { FIXTURES } from '../src/fixtures.ts';

const base = process.argv[2] ?? 'http://localhost:4110/';
const browser = await puppeteer.launch();
const results = await Promise.all(
  FIXTURES.map(async (qs, i) => {
    const page = await browser.newPage();
    const errs = [];
    page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(`${base}?${qs}`);
    await page
      .waitForSelector('body[data-done]', { timeout: 300000 })
      .catch(() => errs.push('Timeout.'));
    const done = await page.$eval('body', (b) => b.dataset.done ?? '');
    await page.close();
    return `${errs.length ? 'FAIL' : 'ok  '} ${String(i + 1).padStart(2)} ${done} ${qs}${errs.map((e) => `\n     ${e}`).join('')}`;
  }),
);
await browser.close();
console.log(results.join('\n'));
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
