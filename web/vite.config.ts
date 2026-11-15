import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset URLs so the build runs from any path or a plain file server.
  base: './',
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        // React, the router and the UI strings in chunks of their own: they change less often than
        // the app (the strings grow with every editor), and the entry chunk stays under the size warning.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'router', test: /node_modules[\\/]react-router[\\/]/ },
            { name: 'i18n', test: /src[\\/]i18n[\\/]/ },
          ],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    // Vitest's defaults, stated on purpose: every test file gets its own worker and a fresh jsdom (UI
    // tests touch module state such as the toast store and <html data-theme>). Stating them also stops
    // the run summary from suggesting a shared environment.
    pool: 'forks',
    isolate: true,
    setupFiles: ['./src/test/setup.ts'],
    // The Playwright suite (npm run e2e) is not Vitest's.
    exclude: [...configDefaults.exclude, 'e2e/**'],
    // Vitest blanks CSS imports, `?raw` included; contrast.test.ts needs the real tokens.css text.
    css: { include: [/tokens\.css/] },
  },
});
