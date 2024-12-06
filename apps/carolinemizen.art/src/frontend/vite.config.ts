import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
});

// https://github.com/vitejs/vite/issues/3107#issuecomment-963692229
