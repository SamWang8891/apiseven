import { createServer } from 'node:net';
import { env, expect, goto, openEditor, openList, t, test, toast } from './fixtures';

/** A loopback port nothing listens on. */
async function closedPort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

test.describe('the Connect page', () => {
  test.use({ connectAs: 'none' });

  async function fill(page: import('@playwright/test').Page, url: string, key: string) {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: t('connect.title') })).toBeVisible();
    await page.getByRole('textbox', { name: t('connect.url') }).fill(url);
    await page.getByRole('textbox', { name: t('connect.key') }).fill(key);
  }

  test.describe('a refused key', () => {
    test.use({ allowConsole: /^401 GET .*\/apisix\/admin\/routes/ });
    test('a wrong key shows that the Admin API rejected it, with APISIX’s reason', async ({ page }) => {
      await fill(page, env.adminUrl, 'not-the-key');
      await page.getByRole('button', { name: t('connect.submit') }).click();
      const alert = page.getByRole('alert');
      await expect(alert).toContainText(t('connect.badKey'));
      await expect(alert).toContainText('wrong apikey');
      await expect(page.getByRole('heading', { level: 1, name: t('connect.title') })).toBeVisible();
    });
  });

  test.describe('an unreachable address', () => {
    test.use({ allowConsole: /^failed GET http:\/\/127\.0\.0\.1:\d+\/apisix\/admin\/routes/ });
    test('the message names allow_admin and enable_admin_cors', async ({ page }) => {
      const url = `http://127.0.0.1:${await closedPort()}`;
      await fill(page, url, env.adminKey);
      await page.getByRole('button', { name: t('connect.submit') }).click();
      const alert = page.getByRole('alert');
      await expect(alert).toContainText(t('connect.network', { url: `${url}/apisix/admin` }));
      await expect(alert).toContainText('allow_admin');
      await expect(alert).toContainText('enable_admin_cors');
    });
  });

  test('a good key opens the routes list', async ({ page }) => {
    await fill(page, env.adminUrl, env.adminKey);
    await page.getByRole('button', { name: t('connect.submit') }).click();
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1, name: t('kind.routes.plural') })).toBeVisible();
    await expect(main.getByRole('link', { name: 'api-v1', exact: true })).toBeVisible();
    expect(new URL(page.url()).hash).toBe('#/routes');
    // Remembered: the key is in localStorage.
    const saved = await page.evaluate(() => localStorage.getItem('apiseven.connections'));
    expect(saved).toContain(env.adminKey);
  });

  test('with "remember" off the key never reaches localStorage, and stays for this tab', async ({ page }) => {
    await fill(page, env.adminUrl, env.adminKey);
    await page.getByRole('checkbox', { name: t('connect.remember') }).click();
    await expect(page.getByRole('checkbox', { name: t('connect.remember') })).not.toBeChecked();
    await page.getByRole('button', { name: t('connect.submit') }).click();
    await expect(page.getByRole('main').getByRole('link', { name: 'api-v1', exact: true })).toBeVisible();
    const local = await page.evaluate(() => JSON.stringify({ ...localStorage }));
    expect(local).toContain('apiseven.connections');
    expect(local).not.toContain(env.adminKey);
    expect(await page.evaluate(() => sessionStorage.getItem('apiseven.sessionKeys'))).toContain(env.adminKey);
    // A reload in the same tab stays connected.
    await page.reload();
    await expect(page.getByRole('main').getByRole('link', { name: 'api-v1', exact: true })).toBeVisible();
  });
});

test.describe('a viewer (read-only) key', () => {
  test.use({ connectAs: 'viewer', allowConsole: /^40[13] (PUT|PATCH) .*\/apisix\/admin\/routes\// });

  test('lists load; a status toggle shows APISIX’s refusal and the read-only banner; Edit is then disabled', async ({ page, admin }) => {
    const main = await openList(page, 'routes');
    await expect(main.getByRole('link', { name: 'old-wiki', exact: true })).toBeVisible();
    const before = await admin.value('routes/old-wiki');
    await main.getByRole('switch', { name: t('table.status.toggle', { name: 'old-wiki' }) }).click();
    await expect(toast(page, /invalid method for role viewer/)).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: t('readOnly.banner') })).toBeVisible();
    // Nothing changed in APISIX, and the list no longer offers the switch or New.
    expect(await admin.value('routes/old-wiki')).toEqual(before);
    await expect(main.getByRole('switch', { name: t('table.status.toggle', { name: 'old-wiki' }) })).toHaveCount(0);
    await expect(main.getByRole('link', { name: t('page.new', { kind: t('kind.routes.singular') }) })).toHaveCount(0);
    // Editors open, but cannot be unlocked.
    const editor = await openEditor(page, 'routes/old-wiki');
    await expect(editor.getByRole('button', { name: t('editor.edit'), exact: true })).toBeDisabled();
  });

  test('a Save from an editor shows APISIX’s refusal and the read-only banner; nothing is stored', async ({ page, admin }) => {
    const before = await admin.value('routes/old-wiki');
    const main = await openEditor(page, 'routes/old-wiki');
    await main.getByRole('button', { name: t('editor.edit'), exact: true }).click();
    await main.getByRole('textbox', { name: t('rt.general.desc') }).fill('a viewer cannot save this');
    await main.getByRole('button', { name: t('editor.save'), exact: true }).click();
    await expect(main.locator('.ed-banner')).toContainText('invalid method for role viewer');
    await expect(page.getByRole('status').filter({ hasText: t('readOnly.banner') })).toBeVisible();
    expect(await admin.value('routes/old-wiki')).toEqual(before);
  });
});

test.describe('two saved connections', () => {
  test.use({ connectAs: 'none' });

  test('the header menu switches between them, and requests then carry the other key', async ({ page, context }) => {
    await context.addInitScript(
      ([baseUrl, adminKey, viewerKey]) => {
        if (sessionStorage.getItem('e2e.connection')) return;
        sessionStorage.setItem('e2e.connection', '1');
        localStorage.setItem(
          'apiseven.connections',
          JSON.stringify([
            { id: 'alpha', name: 'alpha', baseUrl, key: adminKey },
            { id: 'beta', name: 'beta', baseUrl, key: viewerKey },
          ]),
        );
        localStorage.setItem('apiseven.activeConnection', 'alpha');
      },
      [env.adminUrl, env.adminKey, env.viewerKey],
    );
    const main = await goto(page, 'upstreams');
    await expect(main.getByRole('link', { name: 'web-pool', exact: true })).toBeVisible();
    const host = new URL(env.adminUrl).host;
    await page.getByRole('button', { name: t('header.connection', { name: 'alpha', host }) }).click();
    const withViewerKey = page.waitForRequest((r) => r.url().includes('/apisix/admin/') && r.headers()['x-api-key'] === env.viewerKey);
    await page.getByRole('menuitem', { name: `beta (${host})` }).click();
    await withViewerKey;
    await expect(page.getByRole('button', { name: t('header.connection', { name: 'beta', host }) })).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'web-pool', exact: true })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('apiseven.activeConnection'))).toBe('beta');
  });
});

// Task 16b item 135 changes this: the header's connection menu goes through the leave question.
test.describe('switching connections from the header with unsaved changes', () => {
  test.use({ connectAs: 'none' });
  test.fixme('16b-135: the header menu asks before dropping an editor’s unsaved changes', async ({ page, context }) => {
    await context.addInitScript(
      ([baseUrl, adminKey]) => {
        if (sessionStorage.getItem('e2e.connection')) return;
        sessionStorage.setItem('e2e.connection', '1');
        localStorage.setItem(
          'apiseven.connections',
          JSON.stringify([
            { id: 'alpha', name: 'alpha', baseUrl, key: adminKey },
            { id: 'beta', name: 'beta', baseUrl, key: adminKey },
          ]),
        );
        localStorage.setItem('apiseven.activeConnection', 'alpha');
      },
      [env.adminUrl, env.adminKey],
    );
    const main = await openEditor(page, 'routes/api-v1');
    await main.getByRole('button', { name: t('editor.edit'), exact: true }).click();
    await main.getByRole('textbox', { name: t('rt.general.desc') }).fill('unsaved');
    const host = new URL(env.adminUrl).host;
    await page.getByRole('button', { name: t('header.connection', { name: 'alpha', host }) }).click();
    await page.getByRole('menuitem', { name: `beta (${host})` }).click();
    const leave = page.getByRole('alertdialog');
    await expect(leave).toBeVisible();
    await leave.getByRole('button', { name: t('ui.cancel') }).click();
    await expect(main.getByRole('textbox', { name: t('rt.general.desc') })).toHaveValue('unsaved');
    expect(await page.evaluate(() => localStorage.getItem('apiseven.activeConnection'))).toBe('alpha');
  });
});

test('a saved connection opens straight on the routes list', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('main').getByRole('heading', { level: 1, name: t('kind.routes.plural') })).toBeVisible();
});
