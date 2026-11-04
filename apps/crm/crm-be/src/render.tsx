import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyRequest } from 'fastify';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DemoBanner } from './ui/DemoBanner';
import { Footer } from './ui/Footer';
import { SiteNav } from './ui/SiteNav';

/** crm-fe builds here. index.ts serves `dist/static` at `/static/`. */
export const FE_DIST = path.join(import.meta.dir, '..', '..', 'crm-fe', 'dist');

/** The part of the Rsbuild manifest that renderPage reads. */
interface Manifest {
  entries: Record<string, { initial: { js?: string[]; css?: string[] } }>;
}

/**
 * The crm-fe entries that a page can add to `main` (see
 * `crm-fe/rsbuild.config.ts`). `passkeys` is the WebAuthn script.
 */
export type Entry = 'passkeys';

/**
 * Read the hashed asset paths of `main` and `entries` from the Rsbuild
 * manifest. renderPage reads the file for each page, so a rebuild in watch
 * mode shows on the next request.
 */
const readAssets = (entries: Entry[]) => {
  const file = path.join(FE_DIST, 'manifest.json');
  let manifest: Manifest;
  try {
    manifest = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(
      `Cannot read ${file}. Run "yarn workspace crm-fe build". (${error})`,
    );
  }
  const js = new Set<string>();
  const css = new Set<string>();
  for (const name of ['main', ...entries]) {
    const initial = manifest.entries[name]?.initial;
    if (!initial) throw new Error(`${file} has no entry "${name}".`);
    for (const src of initial.js ?? []) js.add(src);
    for (const href of initial.css ?? []) css.add(href);
  }
  return { js: [...js], css: [...css] };
};

/** The themes. `bare` is the page with no page styles and no scripts. */
export type Theme = 'pixel-3' | 'bare';

/**
 * The theme of a request: `bare` when the URL has `?theme=bare`, otherwise
 * `pixel-3`. A person uses `?theme=bare` to see a page as raw HTML
 * (REQ-CRM-BARE-001).
 */
export const themeOf = (request: FastifyRequest): Theme =>
  (request.query as { theme?: unknown } | undefined)?.theme === 'bare'
    ? 'bare'
    : 'pixel-3';

/** The parts of a page, in the order of the anatomy. */
export interface PageParts {
  /** The text of `<title>`, before " - crm". */
  title: string;
  /** At most one sentence under the nav. */
  intro?: ReactNode;
  /**
   * The device of a page on the rack layout (REQ-CRM-LAYOUT-002): one
   * `Rack`, at the full width of the page.
   */
  rack?: ReactNode;
  /**
   * The data of a page on the rack layout: one or more `Band`s, under the
   * rack, at the full width of the page.
   */
  band?: ReactNode;
  /**
   * The core function of a page on the old layout (REQ-CRM-LAYOUT-001):
   * one `Device`, in the left column. Each page moves to `rack` in its own
   * change.
   */
  device?: ReactNode;
  /**
   * Plain text at the top of the right column: help, and links that are
   * not nav.
   */
  help?: ReactNode;
  /** The data of the page: each section in a `Box`, in the right column. */
  boxes?: ReactNode;
  /** The crm-fe entries that the page adds to `main`. */
  entries?: Entry[];
}

/**
 * Render one page to a full HTML document. Every page has the same
 * anatomy, from the top:
 *
 * 1. The nav (`ui/SiteNav.tsx`): the path title, then the app links for a
 *    signed-in person. The title is the first element in `<body>`.
 * 2. The intro: at most one sentence.
 * 3. On the rack layout (REQ-CRM-LAYOUT-002): the rack (the device), then
 *    the band (the data), each at the full width of the page.
 * 4. On the old layout (REQ-CRM-LAYOUT-001): the device in the left
 *    column (`.device-col`), and the help and the boxes in the right
 *    column (`.data-col`).
 * 5. The footer (`ui/Footer.tsx`): `privacy` and `top`.
 *
 * The layout has one width breakpoint, in `crm-fe/src/theme.css`. On a
 * wide screen the app links move to the footer row. On a narrow screen
 * the page is one column, in the order of the HTML.
 *
 * The `<head>` has the asset tags of the `main` entry and of `entries` from
 * the Rsbuild manifest. With `?theme=bare` it has no asset tags. The color
 * mode follows the system (`prefers-color-scheme`).
 */
export const renderPage = (
  request: FastifyRequest,
  { title, intro, rack, band, device, help, boxes, entries = [] }: PageParts,
): string => {
  const { js, css } =
    themeOf(request) === 'bare' ? { js: [], css: [] } : readAssets(entries);
  return `<!doctype html>${renderToStaticMarkup(
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <title>{`${title} - crm`}</title>
        {css.map((href) => (
          <link key={href} rel="stylesheet" href={href} />
        ))}
        {js.map((src) => (
          <script key={src} src={src} defer />
        ))}
      </head>
      <body>
        <DemoBanner />
        <SiteNav
          path={request.url.split('?')[0]}
          signedIn={Boolean(request.auth)}
        />
        <main>
          {intro && <p className="intro">{intro}</p>}
          {rack}
          {band}
          {(device || help || boxes) && (
            <div className="body">
              {device && <div className="device-col">{device}</div>}
              {(help || boxes) && (
                <div className="data-col">
                  {help && <div className="help">{help}</div>}
                  {boxes && <div className="boxes">{boxes}</div>}
                </div>
              )}
            </div>
          )}
        </main>
        <Footer />
      </body>
    </html>,
  )}`;
};
