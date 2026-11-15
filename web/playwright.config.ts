// The end-to-end suite: a real Chromium against the built app (`vite preview`) and a real APISIX.
//
//   make dev-up && cd web && npm run e2e      (make e2e does the same from the repository root)
//
// Before the run, globalSetup checks that the Admin API answers and runs `node dev/seed.mjs --reset`;
// after it, globalTeardown checks that APISIX holds exactly the seed again. The specs share that one
// APISIX, so they run one at a time.
//
// Where things are, each with its default (the dev stack in dev/compose.yaml):
//   E2E_ADMIN_URL         the Admin API                              http://127.0.0.1:19180
//   E2E_ADMIN_KEY         an admin key                               apiseven-dev-admin-key
//   E2E_VIEWER_KEY        a viewer (read-only) key                   apiseven-dev-viewer-key
//   E2E_GATEWAY_URL       the gateway's HTTP listener                http://127.0.0.1:9080
//   E2E_GATEWAY_HTTPS     the gateway's HTTPS listener, host:port    127.0.0.1:9443
//   E2E_GATEWAY_STREAM    the gateway's TCP stream proxy, host:port  127.0.0.1:9100
//   E2E_PREVIEW_PORT      the port `vite preview` serves the app on  4173
//   E2E_DOCKER_NETWORK    APISIX's Docker network (proxy mode)       apiseven-dev_default
//   E2E_DOCKER_ADMIN_URL  the Admin API as seen on that network      http://apisix:9180
//   E2E_IMAGE             the apiseven image (proxy mode)            apiseven:local (make docker)
// proxy-mode.spec.ts needs Docker and that image; single-file.spec.ts needs `npm run build:single`.
// Each skips with the reason when what it needs is missing.
import { defineConfig, devices } from '@playwright/test';
import { env } from './e2e/env';

export default defineConfig({
  testDir: './e2e',
  testMatch: '*.spec.ts',
  outputDir: './test-results',
  globalSetup: './e2e/globalSetup.ts',
  globalTeardown: './e2e/globalTeardown.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  // Generous for a busy machine: every wait is on a request, a role or text, never a fixed sleep.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: env.baseURL,
    viewport: { width: 1280, height: 800 },
    colorScheme: 'light',
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium' }],
  webServer: {
    command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${env.previewPort} --strictPort`,
    url: `${env.baseURL}/`,
    reuseExistingServer: true,
    timeout: 300_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
