// The command palette (Cmd/Ctrl-K): finds objects by what people know them by, and Enter opens them.
import type { Page } from '@playwright/test';
import { EC_PAIR } from '../src/test/pairs';
import { Admin, expect, goto, t, test, uid } from './fixtures';

const PREFIX = 'e2e-search-';

test.afterAll(async () => {
  await new Admin().removePrefixed(PREFIX);
});

async function search(page: Page, query: string) {
  await page.keyboard.press('ControlOrMeta+k');
  const palette = page.getByRole('dialog', { name: t('palette.title') });
  await expect(palette).toBeVisible();
  await palette.getByRole('combobox', { name: t('palette.input') }).fill(query);
  return palette;
}

test('Cmd/Ctrl-K finds a route by its host; Enter opens it', async ({ page }) => {
  await goto(page, 'upstreams');
  const palette = await search(page, 'grpc.apiseven.test');
  const option = palette.getByRole('option', { name: /^grpc-greeter/ });
  await expect(option).toBeVisible();
  await expect(option).toContainText('grpc.apiseven.test');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/routes\/grpc-greeter$/);
  await expect(page.getByRole('main').getByRole('heading', { level: 1, name: 'grpc-greeter' })).toBeVisible();
  await expect(palette).toBeHidden();
});

test('finds a consumer by its username; Enter opens it', async ({ page }) => {
  await goto(page, 'routes');
  const palette = await search(page, 'alice');
  await expect(palette.getByRole('option', { name: /^alice/ }).first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/consumers\/alice$/);
  await expect(page.getByRole('main').getByRole('heading', { level: 1, name: 'alice' })).toBeVisible();
});

test('finds an SSL certificate by its SNI; Enter opens it', async ({ page, admin }) => {
  const id = `${PREFIX}${uid()}`;
  const sni = `${id}.palette.test`;
  await admin.put(`ssls/${id}`, { snis: [sni], cert: EC_PAIR.cert, key: EC_PAIR.key });
  await goto(page, 'routes');
  const palette = await search(page, sni);
  await expect(palette.getByRole('option', { name: new RegExp(sni.replace(/\./g, '\\.')) }).first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`#/ssls/${id}$`));
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
});
