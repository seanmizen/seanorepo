import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginGlsl } from 'rsbuild-plugin-glsl';

export default defineConfig({
  plugins: [pluginReact(), pluginGlsl()],
  source: {
    entry: { index: './src/index.tsx' },
  },
  html: {
    template: './public/index.html',
  },
  output: {
    /* Absolute, so a nested route such as /projects/shaders loads its
       scripts from /static and not from /projects/static. */
    assetPrefix: '/',
  },
});
