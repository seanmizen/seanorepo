// Lighthouse perf/SEO budget enforcement (Phase 1 targets).
//
// Budgets per the SEAN-113 issue body:
//   - LCP < 1.2s
//   - Route JS < 80 kb
//
// We use playwright-lighthouse against a Chromium instance launched with
// a remote debugging port. The library spins up Lighthouse in-process
// against that port, returns the categories + audits, and lets us
// assert on specific metric values.
//
// In dev mode (`next dev`) Lighthouse measurements are noisy — the LCP
// metric in particular is dominated by HMR + uncached chunks. We use
// `productionBudget=true` to gate stricter assertions to a `LIGHTHOUSE_PROD`
// env var (set when running against `yarn build && yarn serve`); in dev,
// we run the audit but only assert on basic categories so the test still
// catches catastrophic regressions (e.g. a 500-error page boots Lighthouse).

import { expect, test } from '@playwright/test';
import { chromium } from 'playwright-core';
import { playAudit } from 'playwright-lighthouse';

const BUDGETS = {
  // LCP budget in milliseconds (Lighthouse reports ms, not s).
  lcpMs: 1200,
  // Route JS budget in bytes (transfer size, gzipped).
  jsBytes: 80 * 1024,
};

const STRICT = process.env.LIGHTHOUSE_PROD === '1';

test.describe('lighthouse — Phase 1 perf budget', () => {
  test('homepage meets the Phase 1 budget', async () => {
    // playwright-lighthouse needs a remote debugging port. We spawn a
    // dedicated browser instance for this spec rather than using the
    // shared `page` fixture.
    const browser = await chromium.launch({
      args: ['--remote-debugging-port=9222'],
    });
    try {
      const page = await browser.newPage();
      await page.goto('http://localhost:4050/');

      const result = await playAudit({
        page,
        port: 9222,
        thresholds: {
          // We don't enforce these as Lighthouse pass/fails because the
          // categories are noisy in dev. Set high-floor values; the real
          // budget is the metric assertion below.
          performance: STRICT ? 80 : 0,
          accessibility: STRICT ? 90 : 0,
          'best-practices': 0,
          seo: 0,
        },
        reports: { formats: { json: false, html: false, csv: false } },
      });

      type Audit = {
        numericValue?: number;
        details?: {
          items?: { resourceType?: string; transferSize?: number }[];
        };
      };
      // Cast to match playwright-lighthouse's loose types.
      const audits = (result.lhr?.audits ?? {}) as Record<string, Audit>;
      const lcpMs = audits['largest-contentful-paint']?.numericValue;
      const totalBytes = audits['total-byte-weight']?.numericValue;
      // Sum transfer sizes for resourceType=Script entries to approximate
      // route JS weight. Lighthouse reports bytes-on-the-wire (post-gzip)
      // here, which matches the AC's "route JS <80kb" framing.
      const items = audits['network-requests']?.details?.items ?? [];
      const jsBytes = items
        .filter((it) => it.resourceType === 'Script')
        .reduce((sum, it) => sum + (it.transferSize ?? 0), 0);

      console.log(
        `[lighthouse] LCP=${lcpMs?.toFixed(0)}ms  total-bytes=${totalBytes?.toFixed(0)}  script-bytes=${jsBytes}`,
      );

      if (STRICT) {
        // Production-mode strict gates — the real budget. Run via:
        //   yarn build && yarn serve & LIGHTHOUSE_PROD=1 yarn test:e2e
        if (typeof lcpMs === 'number') {
          expect(lcpMs).toBeLessThan(BUDGETS.lcpMs);
        }
        expect(jsBytes).toBeLessThan(BUDGETS.jsBytes);
      } else {
        // Dev-mode soft gates — we just verify Lighthouse ran and produced
        // a number for LCP (catches the "page returned 500 / didn't paint"
        // regression). The strict budget is enforced in CI via
        // LIGHTHOUSE_PROD=1.
        expect(lcpMs).toBeDefined();
        expect(typeof lcpMs).toBe('number');
      }
    } finally {
      await browser.close();
    }
  });
});
