import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The no-backend preview build.
 *
 * Relative base so the bundle runs from any static path, and everything in one
 * file so the page needs a single script tag.
 */
export default defineConfig({
  plugins: [react()],
  base: './',
  define: { 'import.meta.env.VITE_PREVIEW': JSON.stringify('1') },
  build: {
    outDir: 'dist-preview',
    sourcemap: false,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'app.js',
        assetFileNames: 'app.[ext]',
      },
    },
  },
});
