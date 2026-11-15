// The single-file export: `npm run build:single` writes dist-single/apiseven.html, one HTML file with
// every script, style and image inside, that runs opened straight from disk (file://) or from any
// static host. Unlike vite.config.ts it has no chunk groups: every lazy part is in the one script.
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { singleFile } from './singleFile.ts';

export default defineConfig({
  base: './',
  plugins: [react(), singleFile(fileURLToPath(new URL('public/favicon-32x32.png', import.meta.url)))],
  // The favicon set and the manifest stay out: a file:// page could not load them (singleFile.ts).
  publicDir: false,
  build: {
    outDir: 'dist-single',
    emptyOutDir: true,
    // Every imported asset (the logo) becomes a data: URL.
    assetsInlineLimit: () => true,
    cssCodeSplit: false,
    modulePreload: false,
    // One script is the point here, so its size is expected (about 1.9 MB, 0.5 MB gzipped).
    chunkSizeWarningLimit: 4096,
    rolldownOptions: { output: { codeSplitting: false } },
  },
});
