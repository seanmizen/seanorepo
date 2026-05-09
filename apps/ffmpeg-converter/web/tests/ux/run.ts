// CLI entry point for the capture harness. Invoked via `yarn test:capture`.
//
// Boots a Playwright browser, drives every registered flow through its
// steps, and writes one timestamped run directory under tests/ux/runs/.
//
// Prereqs:
//   - The Next.js dev server running on :4050 (yarn workspace
//     ffmpeg-converter-next dev). The harness does NOT start it for you;
//     the deterministic Playwright config does, and we deliberately keep
//     this script lightweight so it can plug into any deployed env later.
//   - Fixture files under tests/fixtures/ (run yarn test:fixtures first).
//
// On success, prints the absolute path to the run directory — a follow-up
// invocation of the `/ux-review` skill consumes that path to produce
// scorecard.md.

import { captureAllFlows } from './capture';
import directToolPageFlow from './flows/direct-tool-page';
import firstTimeVisitorFlow from './flows/first-time-visitor';

async function main(): Promise<void> {
  const flows = [firstTimeVisitorFlow, directToolPageFlow];
  const dir = await captureAllFlows(flows, {
    headless: process.env.HEADED !== '1',
  });
  // eslint-disable-next-line no-console
  console.log(`\n[capture] run complete: ${dir}`);
  // eslint-disable-next-line no-console
  console.log(
    '[capture] next: invoke /ux-review with this path to score the run.',
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[capture] failed:', err);
  process.exit(1);
});
