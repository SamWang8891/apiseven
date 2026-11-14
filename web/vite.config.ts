import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset URLs so the build runs from any path or a plain file server.
  base: './',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Vitest blanks CSS imports, `?raw` included; contrast.test.ts needs the real tokens.css text.
    css: { include: [/tokens\.css/] },
  },
});
