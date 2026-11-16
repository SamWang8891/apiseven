// The single-file export (web/dist-single/apiseven.html, `npm run build:single` or `make single`),
// opened straight from disk. When the file has not been built the spec is skipped and the reason is
// printed; with E2E_REQUIRE_SINGLE=1 (which `make e2e` sets, after building it) that is a failure.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Page } from '@playwright/test';
import { expectMarkBesideName } from './brand';
import { env, expect, t, test } from './fixtures';

const FILE = fileURLToPath(new URL('../dist-single/apiseven.html', import.meta.url));
const URL_ = pathToFileURL(FILE).href;
const missing = existsSync(FILE) ? undefined : `${FILE} is missing: build it with \`npm run build:single\` (or \`make single\`)`;
const required = process.env.E2E_REQUIRE_SINGLE === '1';
if (missing) console.warn(`single-file.spec.ts: ${required ? 'cannot run' : 'skipped'}: ${missing}`);

/** Connects from the Connect page with the Admin API address and the admin key. */
async function connect(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: t('connect.title') })).toBeVisible();
  await page.getByRole('textbox', { name: t('connect.url') }).fill(env.adminUrl);
  await page.getByRole('textbox', { name: t('connect.key') }).fill(env.adminKey);
  await page.getByRole('button', { name: t('connect.submit') }).click();
}

test.describe('the single file, opened from disk', () => {
  test.skip(missing !== undefined && !required, missing ?? '');
  test.beforeAll(() => {
    if (missing) throw new Error(`the single file cannot run: ${missing}`);
  });
  test.use({
    connectAs: 'none',
    // Under file:// the app's probe for server mode (./config.json) cannot be fetched; it goes on in
    // static mode, as Task 17 found.
    allowConsole: /config\.json/,
  });

  // C2: the file carries the notice and names the licence; the three licence files are beside it.
  test('starts with a comment holding the NOTICE, the licence, and where the bundled libraries\' licences are', () => {
    const text = readFileSync(FILE, 'utf8');
    const notice = readFileSync(fileURLToPath(new URL('../../NOTICE', import.meta.url)), 'utf8').trim().split('\n')[0]!;
    expect(text.startsWith('<!--\n')).toBe(true);
    const comment = text.slice(0, text.indexOf('-->'));
    expect(comment).toContain(notice);
    expect(comment).toContain('Apache-2.0');
    expect(comment).toContain('THIRD-PARTY-LICENSES.txt');
    expect(text.slice(text.indexOf('-->') + 3).trimStart().toLowerCase().startsWith('<!doctype html>')).toBe(true);
    for (const file of ['LICENSE.txt', 'NOTICE.txt', 'THIRD-PARTY-LICENSES.txt']) expect(existsSync(fileURLToPath(new URL(file, URL_))), file).toBe(true);
  });

  test('connects to APISIX, the routes list loads, an editor opens, and nothing else is fetched', async ({ page }) => {
    const elsewhere: string[] = [];
    page.on('request', (r) => {
      const url = r.url();
      if (!url.startsWith(URL_) && !url.startsWith(`${env.adminUrl}/apisix/admin/`) && !url.startsWith('data:')) elsewhere.push(url);
    });
    await page.goto(URL_);
    await connect(page);
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1, name: t('kind.routes.plural') })).toBeVisible();
    await expect(main.getByRole('link', { name: 'api-v1', exact: true })).toBeVisible();
    await main.getByRole('link', { name: 'api-v1', exact: true }).click();
    await expect(main.getByRole('heading', { level: 1, name: 'api-v1' })).toBeVisible();
    await main.getByRole('tab', { name: t('editor.json.tab') }).click();
    await expect(main.getByRole('textbox', { name: t('editor.json.label', { kind: t('kind.routes.singular') }) })).toBeVisible();
    expect(new URL(page.url()).protocol).toBe('file:');
    // The other requests went to APISIX, or to the file itself (its own hash routes), only.
    expect(elsewhere.filter((u) => !u.endsWith('/config.json'))).toEqual([]);
    // Remembered: a reload stays connected.
    await page.reload();
    await expect(page.getByRole('main').getByRole('heading', { level: 1, name: 'api-v1' })).toBeVisible();
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`${scheme}: the page icon is a data: URL, and Connect and the sidebar show the mark beside the name`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(URL_);
      const icons = await page.evaluate(() => [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')].map((l) => l.getAttribute('href') ?? ''));
      expect(icons.length).toBeGreaterThan(0);
      for (const href of icons) expect(href.startsWith('data:image/png;base64,'), href.slice(0, 40)).toBe(true);
      // No manifest: the single file has no second file to point at.
      expect(await page.locator('link[rel="manifest"]').count()).toBe(0);
      await expectMarkBesideName(page, 'connect');
      await connect(page);
      await expect(page.getByRole('main').getByRole('link', { name: 'api-v1', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(scheme);
      await expectMarkBesideName(page, 'sidebar');
      expect(await page.getByRole('link', { name: t('shell.home') }).locator('img').getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    });
  }
});
