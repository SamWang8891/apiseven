import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // The Playwright suite runs in Node; its fixtures' `use` is Playwright's, not a React hook, and a
    // fixture with no dependencies takes `{}` by Playwright's convention.
    files: ['e2e/**/*.ts', 'playwright.config.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      'react-hooks/rules-of-hooks': 'off',
      'no-empty-pattern': 'off',
    },
  },
]);
