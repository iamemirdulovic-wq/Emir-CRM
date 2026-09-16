import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // The API and the SPA are same-origin in production; in development the
      // dev server proxies so the session cookie still works.
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/webhooks': { target: 'http://localhost:3000', changeOrigin: true },
      '/b': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
