// Where: apps/thirty. When: after a build, against a running server. A full grid takes up to about an hour.
// Why: runs bench.html in headless Chrome with WebGPU and prints its table as Markdown. Each row prints
// to stderr when it is done. Fails on a J mismatch, a page error, or no WebGPU adapter.
// Usage: node scripts/bench-gpu.mjs <base URL> [query, for example city=london&samples=32,256]
import puppeteer from 'puppeteer';

const [base = 'http://localhost:4110/', qs = ''] = process.argv.slice(2);
const browser = await puppeteer.launch({
  args: ['--enable-unsafe-webgpu'],
  protocolTimeout: 864e5,
});
const page = await browser.newPage();
const errs = [];
page.on('console', (m) =>
  m.type() === 'error' ? errs.push(m.text()) : console.error(m.text()),
);
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`${base}bench.html?${qs}`);
await page.waitForSelector('body[data-done]', { timeout: 0 });
const rows = await page.$$eval('tr', (trs) =>
  trs.map((tr) => [...tr.cells].map((c) => c.textContent)),
);
const gpu = await page.$eval('body', (b) => b.dataset.gpu);
await browser.close();
const md = rows.map((r) => `| ${r.join(' | ')} |`);
md.splice(1, 0, `|${' --- |'.repeat(rows[0].length)}`);
console.log(md.join('\n'));
if (gpu !== '1') errs.push('No WebGPU adapter.');
if (rows.some((r) => r.at(-1) === 'no')) errs.push('J mismatch.');
for (const e of errs) console.error(`FAIL ${e}`);
process.exit(errs.length ? 1 : 0);
