import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/** crm-fe builds here. index.ts serves `dist/static` at `/static/`. */
export const FE_DIST = path.join(import.meta.dir, '..', '..', 'crm-fe', 'dist');

/** The part of the Rsbuild manifest that renderPage reads. */
interface Manifest {
  entries: { main: { initial: { js?: string[]; css?: string[] } } };
}

/**
 * Read the hashed asset paths from the Rsbuild manifest. renderPage reads the
 * file for each page, so a rebuild in watch mode shows on the next request.
 */
const readAssets = () => {
  const file = path.join(FE_DIST, 'manifest.json');
  let manifest: Manifest;
  try {
    manifest = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(
      `Cannot read ${file}. Run "yarn workspace crm-fe build". (${error})`,
    );
  }
  const { js = [], css = [] } = manifest.entries.main.initial;
  return { js, css };
};

/**
 * Render one page to a full HTML document: the doctype, the `<head>` with the
 * asset tags from the Rsbuild manifest, and `children` in the `<body>`.
 */
export const renderPage = (title: string, children: ReactNode): string => {
  const { js, css } = readAssets();
  return `<!doctype html>${renderToStaticMarkup(
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <title>{title}</title>
        {css.map((href) => (
          <link key={href} rel="stylesheet" href={href} />
        ))}
        {js.map((src) => (
          <script key={src} src={src} defer />
        ))}
      </head>
      <body>{children}</body>
    </html>,
  )}`;
};
