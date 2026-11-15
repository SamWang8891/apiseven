// Proxy mode: the Docker image serving the app and its Admin API proxy (task-17-report.md). Builds
// nothing: it runs E2E_IMAGE (`make docker`) on APISIX's Docker network, one container per setup,
// and removes each afterwards. Skipped, with the reason, when Docker or the image is missing.
import { execFileSync } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import type { Browser, Page } from '@playwright/test';
import { Admin, env, expect, expectIconsServed, expectMarkBesideName, openTab, t, test } from './fixtures';
import { freePort, servePage } from './servers';

function docker(args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Why the spec cannot run here, or undefined. */
function unavailable(): string | undefined {
  try {
    docker(['version', '--format', '{{.Server.Version}}']);
  } catch {
    return 'Docker is not available';
  }
  try {
    docker(['image', 'inspect', env.image]);
  } catch {
    return `the image ${env.image} is missing: build it with \`make docker\` (or set E2E_IMAGE)`;
  }
  try {
    docker(['network', 'inspect', env.dockerNetwork]);
  } catch {
    return `the Docker network ${env.dockerNetwork} (APISIX's) is missing: start the dev stack (or set E2E_DOCKER_NETWORK)`;
  }
  return undefined;
}

const reason = unavailable();
const BASIC = { username: 'e2e', password: 'e2e-basic-password' };

interface Container {
  name: string;
  url: string;
  port: number;
}

/** Runs the image with these variables, published on a free loopback port; waits for /healthz. */
async function start(mode: string, vars: Record<string, string>): Promise<Container> {
  const port = await freePort();
  const name = `apiseven-e2e-${mode}-${process.pid}`;
  stop({ name, url: '', port: 0 });
  docker([
    'run', '-d', '--name', name,
    '--network', env.dockerNetwork,
    '-p', `127.0.0.1:${port}:8080`,
    '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
    '-e', `APISIX_ADMIN_URL=${env.dockerAdminUrl}`,
    ...Object.entries(vars).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
    env.image,
  ]);
  const url = `http://127.0.0.1:${port}`;
  await expect
    .poll(async () => (await fetch(`${url}/healthz`).then((r) => r.text()).catch(() => '')).trim(), { timeout: 30_000 })
    .toBe('ok');
  return { name, url, port };
}

/** Removes this spec's container, by its name (only ever one this spec started). */
function stop(container: Container | undefined): void {
  if (!container) return;
  try {
    docker(['rm', '-f', container.name]);
  } catch {
    // Not there.
  }
}

/** A raw request to the container, with whatever Host header the test wants. */
function raw(container: Container, path: string, headers: Record<string, string>): Promise<{ status: number; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: container.port, path, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

/** Records Content-Security-Policy violations in every page of the context. */
async function watchCsp(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  return () => page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
}

test.describe('proxy mode (the Docker image)', () => {
  test.skip(reason !== undefined, reason ?? '');
  test.use({ connectAs: 'none' });

  test.describe('with a server key', () => {
    let box: Container | undefined;
    test.beforeAll(async () => {
      box = await start('serverkey', { APISIX_ADMIN_KEY: env.adminKey });
    });
    test.afterAll(() => stop(box));

    test('the routes list loads with no Connect page; requests carry X-Apiseven-Request and no key', async ({ page }) => {
      const admin = page.waitForRequest((r) => r.url().startsWith(`${box!.url}/apisix/admin/`));
      await page.goto(`${box!.url}/`);
      const main = page.getByRole('main');
      await expect(main.getByRole('heading', { level: 1, name: t('kind.routes.plural') })).toBeVisible();
      await expect(main.getByRole('link', { name: 'api-v1', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: t('connect.title') })).toHaveCount(0);
      const req = await admin;
      expect(req.headers()['x-apiseven-request']).toBe('1');
      expect(req.headers()['x-api-key']).toBeUndefined();
    });

    test('no Content-Security-Policy violation on the list, an editor, a plugin form and the JSON tab', async ({ page }) => {
      const violations = await watchCsp(page);
      await page.goto(`${box!.url}/#/routes`);
      await expect(page.getByRole('main').getByRole('link', { name: 'api-v1', exact: true })).toBeVisible();
      expect(await violations()).toEqual([]);
      await page.goto(`${box!.url}/#/routes/api-v1?tab=plugins`);
      const main = page.getByRole('main');
      await main.getByRole('button', { name: t('editor.edit'), exact: true }).click();
      await main.getByRole('button', { name: /^limit-count\b/ }).first().click();
      await expect(main.getByRole('group', { name: 'limit-count', exact: true }).getByRole('textbox', { name: /^count\b/ })).toBeVisible();
      expect(await violations()).toEqual([]);
      await openTab(page, t('editor.json.tab'));
      await expect(main.getByRole('textbox', { name: t('editor.json.label', { kind: t('kind.routes.singular') }) })).toBeVisible();
      await main.getByRole('button', { name: t('editor.discard'), exact: true }).click();
      expect(await violations()).toEqual([]);
    });

    test('a request without X-Apiseven-Request is refused (403), marked as the server’s refusal', async () => {
      const without = await fetch(`${box!.url}/apisix/admin/routes`);
      expect(without.status).toBe(403);
      expect(without.headers.get('x-apiseven-refusal')).toBe('header');
      const withIt = await fetch(`${box!.url}/apisix/admin/routes`, { headers: { 'X-Apiseven-Request': '1' } });
      expect(withIt.status).toBe(200);
    });

    test('a Host that is not an IP address or localhost is refused (403) without Basic auth', async () => {
      const named = await raw(box!, '/', { Host: 'apiseven.e2e.test' });
      expect(named.status).toBe(403);
      expect(named.headers['x-apiseven-refusal']).toBe('host');
      expect((await raw(box!, '/', { Host: `127.0.0.1:${box!.port}` })).status).toBe(200);
    });

    test.describe('a page on another origin', () => {
      test.use({ allowConsole: /^(failed|403) POST .*\/apisix\/admin\/routes/ });
      test('cannot create a route with a text/plain POST', async ({ page }) => {
        const admin = new Admin();
        const before = (await admin.list('routes')).length;
        const evil = await servePage('<!doctype html><title>elsewhere</title><p>another origin</p>');
        try {
          await page.goto(evil.url);
          const outcome = await page.evaluate(async (target) => {
            try {
              await fetch(`${target}/apisix/admin/routes`, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ name: 'e2e-proxy-evil', uri: '/evil', upstream: { nodes: { '127.0.0.1:1': 1 } } }),
              });
              return 'sent';
            } catch (e) {
              return `refused: ${String(e)}`;
            }
          }, box!.url);
          expect(outcome).toMatch(/sent|refused/);
        } finally {
          await evil.close();
        }
        const after = await admin.list('routes');
        expect(after).toHaveLength(before);
        expect(after.some((r) => r.value.name === 'e2e-proxy-evil')).toBe(false);
      });
    });

    for (const scheme of ['light', 'dark'] as const) {
      test(`${scheme}: the icons and the manifest load, and the sidebar shows the mark beside the name`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(`${box!.url}/#/routes`);
        await expect(page.getByRole('main').getByRole('link', { name: 'api-v1', exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(scheme);
        await expectIconsServed(page);
        await expectMarkBesideName(page, 'sidebar');
      });
    }
  });

  test.describe('without a server key', () => {
    let box: Container | undefined;
    test.beforeAll(async () => {
      box = await start('keymode', {});
    });
    test.afterAll(() => stop(box));

    test('the Connect page asks only for the key, and a good key opens the routes list', async ({ page }) => {
      await page.goto(`${box!.url}/`);
      await expect(page.getByRole('heading', { level: 1, name: t('connect.title') })).toBeVisible();
      await expect(page.getByRole('textbox', { name: t('connect.url') })).toHaveCount(0);
      await expect(page.getByRole('textbox', { name: t('connect.name') })).toHaveCount(0);
      await page.getByRole('textbox', { name: t('connect.key') }).fill(env.adminKey);
      await page.getByRole('button', { name: t('connect.submit') }).click();
      await expect(page.getByRole('main').getByRole('link', { name: 'api-v1', exact: true })).toBeVisible();
    });

    for (const scheme of ['light', 'dark'] as const) {
      test(`${scheme}: the Connect page shows the mark beside the name`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(`${box!.url}/`);
        await expect(page.getByRole('heading', { level: 1, name: t('connect.title') })).toBeVisible();
        await expectMarkBesideName(page, 'connect');
        await expectIconsServed(page);
      });
    }
  });

  test.describe('with Basic auth', () => {
    let box: Container | undefined;
    test.beforeAll(async () => {
      box = await start('basicauth', { APISIX_ADMIN_KEY: env.adminKey, BASIC_AUTH_USER: BASIC.username, BASIC_AUTH_PASSWORD: BASIC.password });
    });
    test.afterAll(() => stop(box));

    test('401 without credentials; with them the routes list loads', async ({ browser }: { browser: Browser }) => {
      expect((await fetch(`${box!.url}/`)).status).toBe(401);
      expect((await fetch(`${box!.url}/apisix/admin/routes`, { headers: { 'X-Apiseven-Request': '1' } })).status).toBe(401);
      expect((await fetch(`${box!.url}/healthz`)).status).toBe(200);
      const context = await browser.newContext({ httpCredentials: BASIC, viewport: { width: 1280, height: 800 } });
      try {
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.goto(`${box!.url}/`);
        await expect(page.getByRole('main').getByRole('link', { name: 'api-v1', exact: true })).toBeVisible();
        await expectIconsServed(page);
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    });
  });

  test.describe('with ALLOWED_HOSTS', () => {
    let box: Container | undefined;
    test.beforeAll(async () => {
      box = await start('allowedhosts', { APISIX_ADMIN_KEY: env.adminKey, ALLOWED_HOSTS: 'apiseven.e2e.test' });
    });
    test.afterAll(() => stop(box));

    test('the name it lists is allowed as Host; another name is still refused', async () => {
      expect((await raw(box!, '/', { Host: 'apiseven.e2e.test' })).status).toBe(200);
      expect((await raw(box!, '/', { Host: `apiseven.e2e.test:${box!.port}` })).status).toBe(200);
      expect((await raw(box!, '/', { Host: 'other.e2e.test' })).status).toBe(403);
    });
  });
});
