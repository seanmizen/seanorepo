import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

export default defineConfig({
  plugins: [pluginReact()],
  html: {
    template: './public/index.html',
  },
  source: {
    define: {
      'import.meta.env.PUBLIC_DEBUG_BACKEND': JSON.stringify(
        process.env.DEBUG_BACKEND || 'false',
      ),
      'import.meta.env.PUBLIC_DEBUG_SHOW_SNACKBAR_TIMER': JSON.stringify(
        process.env.DEBUG_SHOW_SNACKBAR_TIMER || 'false',
      ),
      'import.meta.env.PUBLIC_DEBUG_SHOW_ATTENDEE_ID': JSON.stringify(
        process.env.DEBUG_SHOW_ATTENDEE_ID || 'false',
      ),
      'import.meta.env.PUBLIC_DEBUG_SHOW_REFRESH_BUTTON': JSON.stringify(
        process.env.DEBUG_SHOW_REFRESH_BUTTON || 'false',
      ),
      'import.meta.env.PUBLIC_HIDE_COPY_URL_BUTTON': JSON.stringify(
        process.env.HIDE_COPY_URL_BUTTON || 'false',
      ),
    },
  },
  resolve: {
    alias: {
      '@': './src',
      react: require.resolve('react'),
      'react-dom': require.resolve('react-dom'),
    },
  },
});
