import { existsSync, readdirSync } from 'node:fs';
import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginGlsl } from 'rsbuild-plugin-glsl';

/* Every stage of an intentionality story is a page of its own, so the
   story can run it in an iframe, apart from the site and from the other
   stages. A stage is a folder with a main.tsx, under its story's folder. */
const STORIES = './src/features/intentionality/stories';
const folders = (dir) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
const samples = Object.fromEntries(
  folders(STORIES).flatMap((story) =>
    folders(`${STORIES}/${story}`)
      .filter((stage) => existsSync(`${STORIES}/${story}/${stage}/main.tsx`))
      .map((stage) => [
        `sample-${story}-${stage}`,
        `${STORIES}/${story}/${stage}/main.tsx`,
      ]),
  ),
);

export default defineConfig({
  plugins: [pluginReact(), pluginGlsl()],
  source: {
    entry: { index: './src/index.tsx', ...samples },
  },
  html: {
    template: './public/index.html',
  },
  output: {
    assetPrefix: './',
  },
});
