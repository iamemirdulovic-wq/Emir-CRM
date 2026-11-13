import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The no-backend preview build.
 *
 * Relative base so the bundle runs from any static path, and everything in one
 * file so the page needs a single script tag.
 *
 * `PREVIEW_OUT` moves the output directory. One build at a time is the normal
 * case and needs nothing; several people (or agents) building the same tree at
 * once each need their own, or the last build wins and they review each
 * other's work by accident. `vite preview` reads the same setting, so the
 * variable has to be set for both commands.
 */
export default defineConfig({
  plugins: [react()],
  base: './',
  define: { 'import.meta.env.VITE_PREVIEW': JSON.stringify('1') },
  build: {
    outDir: process.env.PREVIEW_OUT ?? 'dist-preview',
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
