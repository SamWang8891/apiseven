// The theme switch, and the owner's logo and favicon in the preview build (proxy-mode.spec.ts and
// single-file.spec.ts check them in the other two ways apiseven runs).
import { fileURLToPath } from 'node:url';
import { expectIconsServed, expectMarkBesideName } from './brand';
import { expect, goto, t, test } from './fixtures';
import { serveStatic } from './servers';

const DIST = fileURLToPath(new URL('../dist', import.meta.url));

async function theme(page: import('@playwright/test').Page): Promise<string | undefined> {
  return page.evaluate(() => document.documentElement.dataset.theme);
}

test.describe('theme', () => {
  test('a chosen theme is applied and kept across a reload', async ({ page }) => {
    await goto(page, 'routes');
    const group = page.getByRole('group', { name: t('theme.label') });
    await expect(group.getByRole('button', { name: t('theme.system') })).toHaveAttribute('aria-pressed', 'true');
    expect(await theme(page)).toBe('light');
    const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await group.getByRole('button', { name: t('theme.dark') }).click();
    await expect.poll(() => theme(page)).toBe('dark');
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe(lightBg);
    await page.reload();
    await expect(page.getByRole('main')).toBeVisible();
    expect(await theme(page)).toBe('dark');
    await expect(page.getByRole('group', { name: t('theme.label') }).getByRole('button', { name: t('theme.dark') })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('group', { name: t('theme.label') }).getByRole('button', { name: t('theme.light') }).click();
    await expect.poll(() => theme(page)).toBe('light');
    await page.reload();
    await expect(page.getByRole('main')).toBeVisible();
    expect(await theme(page)).toBe('light');
  });

  test('Match system follows the system’s colour scheme, also when it changes', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await goto(page, 'routes');
    expect(await theme(page)).toBe('dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(() => theme(page)).toBe('light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(() => theme(page)).toBe('dark');
  });
});

test.describe('logo and favicon (the preview build)', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`${scheme}: the icons and the manifest load, and the sidebar shows the mark beside the name`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await goto(page, 'routes');
      expect(await theme(page)).toBe(scheme);
      await expectIconsServed(page);
      await expectMarkBesideName(page, 'sidebar');
    });
  }

  test.describe('the Connect page', () => {
    test.use({ connectAs: 'none' });
    for (const scheme of ['light', 'dark'] as const) {
      test(`${scheme}: the mark beside the name`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto('/');
        await expect(page.getByRole('heading', { level: 1, name: t('connect.title') })).toBeVisible();
        await expectMarkBesideName(page, 'connect');
      });
    }
  });

  test('served from a sub-path (/sub/): every icon, the manifest and the logo still load', async ({ page }) => {
    const server = await serveStatic(DIST, '/sub/');
    try {
      const failed: string[] = [];
      page.on('response', (r) => {
        if (r.status() >= 400 && !r.url().endsWith('/config.json')) failed.push(`${r.status()} ${r.url()}`);
      });
      await page.goto(`${server.url}/sub/#/routes`);
      await expect(page.getByRole('main').getByRole('heading', { level: 1, name: t('kind.routes.plural') })).toBeVisible();
      for (const { href } of await page.evaluate(() => [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"], link[rel="manifest"]')].map((l) => ({ href: l.href })))) {
        expect(href.startsWith(`${server.url}/sub/`), href).toBe(true);
      }
      await expectIconsServed(page);
      await expectMarkBesideName(page, 'sidebar');
      expect(failed).toEqual([]);
    } finally {
      await server.close();
    }
  });
});
