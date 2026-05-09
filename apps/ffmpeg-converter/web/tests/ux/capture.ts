// Capture harness — drives a Playwright page through a flow's `steps` and
// writes a complete evidence bundle per step (screenshot + aria snapshot +
// console logs + network HAR) to:
//
//   tests/ux/runs/{timestamp}/{flow}/
//     ├── 01-landing/
//     │   ├── screenshot.png
//     │   ├── aria.json
//     │   ├── console.log
//     │   └── network.har
//     ├── 02-drop-file/
//     │   └── ...
//     ├── manifest.json   ← { flow, capturedAt, steps: [...] }
//     └── flow.har        ← session-level HAR for the whole flow
//
// The bundle is consumed by the `/ux-review` skill which reads each step's
// PNG + aria.json into a vision prompt and scores against `rubric.ts`.

import fs from 'node:fs';
import path from 'node:path';
import {
  type BrowserContext,
  type ConsoleMessage,
  chromium,
  type Page,
} from '@playwright/test';

export interface CaptureStep {
  /** Short slug — becomes the directory name under the flow. */
  name: string;
  /** Human-readable description of what happens at this step. */
  description: string;
  /** Drive the page. May return; capture happens after. */
  run: (page: Page) => Promise<void>;
}

export interface Flow {
  /** Slug used for the per-flow directory under runs/{timestamp}/. */
  name: string;
  /** Human-readable description for the manifest. */
  description: string;
  steps: CaptureStep[];
}

export interface CaptureOptions {
  /** Where to root the run directory. Defaults to `tests/ux/runs`. */
  runsRoot?: string;
  /** Override the timestamp directory (used by tests for determinism). */
  timestamp?: string;
  /** Base URL for `page.goto('/')`. Defaults to env or :4050. */
  baseURL?: string;
  /** Headless toggle; default true. */
  headless?: boolean;
}

interface CapturedStep {
  index: number;
  name: string;
  description: string;
  /** Relative paths from the flow directory — compact for manifest. */
  artefacts: {
    screenshot: string;
    aria: string;
    console: string;
    network: string;
  };
}

interface Manifest {
  flow: string;
  description: string;
  capturedAt: string;
  baseURL: string;
  steps: CapturedStep[];
}

const DEFAULT_BASE_URL = process.env.BASE_URL ?? 'http://localhost:4050';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Run a single flow and emit its evidence bundle. Returns the absolute
 * path to the flow directory. Safe to call many times in one process —
 * each call gets its own browser context and HAR file.
 */
export async function captureFlow(
  flow: Flow,
  opts: CaptureOptions = {},
): Promise<string> {
  const runsRoot = opts.runsRoot ?? path.resolve(__dirname, 'runs');
  const ts =
    opts.timestamp ??
    new Date().toISOString().replace(/[:.]/g, '-').replace('Z', 'Z');
  const flowDir = path.join(runsRoot, ts, flow.name);
  fs.mkdirSync(flowDir, { recursive: true });

  const baseURL = opts.baseURL ?? DEFAULT_BASE_URL;
  const headless = opts.headless ?? true;

  const browser = await chromium.launch({ headless });
  const flowHar = path.join(flowDir, 'flow.har');
  const context: BrowserContext = await browser.newContext({
    baseURL,
    recordHar: { path: flowHar, content: 'omit' },
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  // Console messages flow into a per-step buffer keyed by step index. We
  // cycle the buffer between steps so each step's console.log only contains
  // messages emitted during that step.
  let consoleBuffer: string[] = [];
  const consoleListener = (msg: ConsoleMessage) => {
    consoleBuffer.push(`[${msg.type()}] ${msg.text()}`);
  };
  page.on('console', consoleListener);
  page.on('pageerror', (err) => {
    consoleBuffer.push(`[pageerror] ${err.message}`);
  });

  const captured: CapturedStep[] = [];

  try {
    for (let i = 0; i < flow.steps.length; i++) {
      const step = flow.steps[i];
      consoleBuffer = []; // reset per step
      // Per-step network HAR: we route through a local recorder. Playwright
      // doesn't expose mid-session HAR rotation cleanly, so we capture the
      // network requests that fire during the step via page.on('request')
      // and serialise to a HAR-like JSON. The flow-level HAR (above) is the
      // source of truth for replay; the per-step file is for human review.
      const requests: Array<{
        method: string;
        url: string;
        status?: number;
        startedAt: number;
      }> = [];
      const reqStart = (req: import('@playwright/test').Request) => {
        requests.push({
          method: req.method(),
          url: req.url(),
          startedAt: Date.now(),
        });
      };
      const resEnd = (res: import('@playwright/test').Response) => {
        const url = res.url();
        const last = requests.find(
          (r) => r.url === url && r.status === undefined,
        );
        if (last) last.status = res.status();
      };
      page.on('request', reqStart);
      page.on('response', resEnd);

      await step.run(page);

      // Capture artefacts after the step's actions land.
      const stepDir = path.join(flowDir, `${pad2(i + 1)}-${step.name}`);
      fs.mkdirSync(stepDir, { recursive: true });

      const screenshotPath = path.join(stepDir, 'screenshot.png');
      await page.screenshot({ path: screenshotPath, fullPage: true });

      const ariaPath = path.join(stepDir, 'aria.json');
      // The aria snapshot is Playwright's accessible name tree — what an
      // assistive tech actually sees. We use `locator('body').ariaSnapshot()`
      // which returns the YAML-style string Playwright uses for aria
      // assertions; we wrap it in JSON for trivial parsing downstream.
      const ariaSnap = await page
        .locator('body')
        .ariaSnapshot()
        .catch(() => '');
      fs.writeFileSync(ariaPath, JSON.stringify({ aria: ariaSnap }, null, 2));

      const consolePath = path.join(stepDir, 'console.log');
      fs.writeFileSync(consolePath, consoleBuffer.join('\n'));

      const networkPath = path.join(stepDir, 'network.har');
      fs.writeFileSync(
        networkPath,
        JSON.stringify(
          {
            log: {
              version: '1.2',
              creator: { name: 'tests/ux/capture.ts', version: '1' },
              entries: requests.map((r) => ({
                startedDateTime: new Date(r.startedAt).toISOString(),
                request: { method: r.method, url: r.url },
                response: { status: r.status ?? 0 },
              })),
            },
          },
          null,
          2,
        ),
      );

      page.off('request', reqStart);
      page.off('response', resEnd);

      captured.push({
        index: i + 1,
        name: step.name,
        description: step.description,
        artefacts: {
          screenshot: path.relative(flowDir, screenshotPath),
          aria: path.relative(flowDir, ariaPath),
          console: path.relative(flowDir, consolePath),
          network: path.relative(flowDir, networkPath),
        },
      });
    }
  } finally {
    page.off('console', consoleListener);
    await context.close(); // flushes flow.har to disk
    await browser.close();
  }

  const manifest: Manifest = {
    flow: flow.name,
    description: flow.description,
    capturedAt: new Date().toISOString(),
    baseURL,
    steps: captured,
  };
  fs.writeFileSync(
    path.join(flowDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  );

  return flowDir;
}

/**
 * Run every flow registered in `tests/ux/flows/` and return the timestamp
 * directory containing all of them. Used by `yarn test:capture`.
 */
export async function captureAllFlows(
  flows: Flow[],
  opts: CaptureOptions = {},
): Promise<string> {
  const runsRoot = opts.runsRoot ?? path.resolve(__dirname, 'runs');
  const ts =
    opts.timestamp ??
    new Date().toISOString().replace(/[:.]/g, '-').replace('Z', 'Z');
  fs.mkdirSync(path.join(runsRoot, ts), { recursive: true });
  for (const flow of flows) {
    // eslint-disable-next-line no-console
    console.log(`[capture] ${flow.name}: ${flow.description}`);
    await captureFlow(flow, { ...opts, timestamp: ts });
  }
  return path.join(runsRoot, ts);
}
