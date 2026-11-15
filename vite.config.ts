import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    chunkSizeWarningLimit: 1500,
  },
  server: {
    // the API (server/index.mjs) holds the keys; the browser only ever talks to /api on its own origin
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', xfwd: true },
    },
  },
});
