import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyRequest } from 'fastify';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
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
  /** The core function of the page: one `Device`. */
  device?: ReactNode;
  /** Plain text under the device: help, and links that are not nav. */
  help?: ReactNode;
  /** History and reference data: `Records`, as text. */
  records?: ReactNode;
  /** The pagination of a long list, in the footer. */
  pager?: ReactNode;
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
 * 3. The device (the core function), with its help text under it.
 * 4. The records: text.
 * 5. The footer (`ui/Footer.tsx`): `top` and the pager.
 *
 * On a wide screen the device is a fixed column at the left, and the
 * records fill the space to its right. On a phone it is one column.
 *
 * The `<head>` has the asset tags of the `main` entry and of `entries` from
 * the Rsbuild manifest. With `?theme=bare` it has no asset tags. The color
 * mode follows the system (`prefers-color-scheme`).
 */
export const renderPage = (
  request: FastifyRequest,
  { title, intro, device, help, records, pager, entries = [] }: PageParts,
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
        <SiteNav
          path={request.url.split('?')[0]}
          signedIn={Boolean(request.auth)}
        />
        <main>
          {intro && <p className="intro">{intro}</p>}
          {(device || help || records) && (
            <div className="body">
              {(device || help) && (
                <div className="device-col">
                  {device}
                  {help && <div className="help">{help}</div>}
                </div>
              )}
              {records && <div className="records-col">{records}</div>}
            </div>
          )}
        </main>
        <Footer pager={pager} />
      </body>
    </html>,
  )}`;
};
