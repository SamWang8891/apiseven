// The single-file export: `npm run build:single` writes dist-single/apiseven.html, one HTML file with
// every script, style and image inside, that runs opened straight from disk (file://) or from any
// static host. It is vite.config.ts (so a plugin, define or alias added there reaches it too) minus
// what a single file cannot have: the chunk groups (every lazy part goes in the one script), the
// public folder, and the tests.
import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vite';
import { singleFile } from './singleFile.ts';
import shared from './vite.config.ts';

export default defineConfig(
  mergeConfig(
    { ...shared, test: undefined },
    {
      plugins: [singleFile(fileURLToPath(new URL('public/favicon-32x32.png', import.meta.url)), fileURLToPath(new URL('../NOTICE', import.meta.url)))],
      // The favicon set and the manifest stay out: a file:// page could not load them (singleFile.ts).
      publicDir: false,
      build: {
        outDir: 'dist-single',
        emptyOutDir: true,
        // Every imported asset (the logo) becomes a data: URL.
        assetsInlineLimit: () => true,
        cssCodeSplit: false,
        modulePreload: false,
        // One script is the point here, so its size is expected (about 1.8 MB, 0.6 MB gzipped).
        chunkSizeWarningLimit: 4096,
        // false replaces the chunk groups of vite.config.ts (mergeConfig lets a value replace an object).
        rolldownOptions: { output: { codeSplitting: false } },
      },
    },
  ),
);
