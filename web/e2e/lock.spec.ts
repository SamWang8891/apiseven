// The lock means no writes (addendum rule 14 and the Task 12 ruling): every editor of every kind opens
// locked with nothing to type into, embedded tables offer no one-click write, and a save leaves the
// page where it was.
import {
  Admin,
  addPlugin,
  echoRoute,
  expect,
  openCard,
  openEditor,
  operableControls,
  recordWrites,
  save,
  settled,
  t,
  test,
  uid,
  unlock,
} from './fixtures';

const PREFIX = 'e2e-lock-';
// Fixed, not random: a test's title names it, and titles must be the same in every worker.
const secretId = `vault/${PREFIX}secret`;
const METADATA = 'http-logger';

test.beforeAll(async () => {
  const admin = new Admin();
  await admin.put(`secrets/${secretId}`, { uri: 'http://127.0.0.1:8200', prefix: 'kv/apisix', token: 'e2e-vault-token' });
  await admin.put(`plugin_metadata/${METADATA}`, { log_format: { host: '$host', client_ip: '$remote_addr' } });
});

test.afterAll(async () => {
  const admin = new Admin();
  await admin.del(`secrets/${secretId}`);
  await admin.del(`plugin_metadata/${METADATA}`);
  await admin.removePrefixed(PREFIX);
});

// One stored object of every kind: the seed's, plus a secret and a plugin metadata entry of this spec.
const EDITORS = [
  'routes/api-v1',
  'routes/billing-api',
  'stream_routes/etcd-tcp',
  'services/web',
  'services/billing',
  'upstreams/api-backend',
  'consumers/alice',
  'consumers/alice/credentials/alice-key',
  'consumer_groups/partners',
  'ssls/apiseven-test',
  'global_rules/default',
  'plugin_configs/common-headers',
  `plugin_metadata/${METADATA}`,
  'protos/helloworld',
  `secrets/${secretId.replace('/', '%2F')}`,
];

test.describe('every editor opens locked', () => {
  for (const path of EDITORS) {
    test(`${path}: every tab has no control to type into or switch`, async ({ page }) => {
      const main = await openEditor(page, path);
      await expect(main.getByText(t('editor.locked'), { exact: true })).toBeVisible();
      const tabs = main.getByRole('tablist').first().getByRole('tab');
      const count = await tabs.count();
      expect(count).toBeGreaterThan(0);
      for (let i = 0; i < count; i++) {
        const tab = tabs.nth(i);
        await tab.click();
        await expect(tab).toHaveAttribute('aria-selected', 'true');
        await settled(page);
        expect(await operableControls(page), `${path}, tab ${await tab.textContent()}`).toEqual([]);
      }
    });
  }
});

test.describe('tables inside an editor', () => {
  const EMBEDDED: [string, string][] = [
    ['services/web?tab=routes', 'web-home'],
    ['plugin_configs/common-headers?tab=used_by', 'shop'],
    ['consumers/alice?tab=credentials', 'alice-key'],
    ['consumer_groups/partners?tab=members', 'alice'],
  ];
  for (const [path, row] of EMBEDDED) {
    test(`${path}: no status switch, and clicking the status sends nothing`, async ({ page }) => {
      const main = await openEditor(page, path);
      const panel = main.getByRole('tabpanel');
      await expect(panel.getByRole('link', { name: row, exact: true })).toBeVisible();
      await expect(panel.getByRole('switch')).toHaveCount(0);
      expect(await operableControls(page)).toEqual([]);
      const writes = recordWrites(page);
      const status = panel.getByRole('row').filter({ has: page.getByRole('link', { name: row, exact: true }) }).getByText(t('table.status.enabled'), { exact: true });
      if ((await status.count()) > 0) await status.click();
      // The row's own menu only navigates or asks first.
      await panel.getByRole('button', { name: t('table.actionsFor', { name: row }) }).click();
      const items = await page.getByRole('menuitem').allTextContents();
      expect(items.filter((i) => [t('action.enable'), t('action.disable')].includes(i))).toEqual([]);
      await page.keyboard.press('Escape');
      expect(writes).toEqual([]);
    });
  }
});

/** How far the page is scrolled: the scroll offset of <main> or of the box around it that scrolls. */
function scrollTop(main: import('@playwright/test').Locator): Promise<number> {
  return main.evaluate((el) => {
    let box: Element | null = el;
    while (box && box.scrollHeight <= box.clientHeight) box = box.parentElement;
    return box ? box.scrollTop : 0;
  });
}

test('after a Save the page stays on the same tab, with the same cards open, scrolled where it was', async ({ page, admin }) => {
  const id = `${PREFIX}${uid()}`;
  await admin.put(
    `routes/${id}`,
    echoRoute(id, `${id}.e2e.test`, {
      plugins: {
        'limit-count': { count: 100, time_window: 60 },
        'proxy-rewrite': { uri: '/version' },
        cors: { allow_origins: 'https://e2e.test' },
      },
    }),
  );
  const main = await openEditor(page, `routes/${id}?tab=plugins`);
  await unlock(page);
  for (const name of ['limit-count', 'proxy-rewrite', 'cors']) await openCard(page, name);
  await addPlugin(page, 'request-id');
  // Scroll the page down to the last card and change a field there.
  const cors = await openCard(page, 'cors');
  const field = cors.getByRole('textbox', { name: /^max_age\b/ }).or(cors.getByRole('spinbutton', { name: /^max_age\b/ }));
  await field.scrollIntoViewIfNeeded();
  await field.fill('600');
  const before = await scrollTop(main);
  expect(before).toBeGreaterThan(0);
  const write = await save(page);
  expect((write.body?.plugins as Record<string, Record<string, unknown>>).cors?.max_age).toBe(600);
  await expect(main.getByRole('tab', { name: /^Plugins/ })).toHaveAttribute('aria-selected', 'true');
  for (const name of ['limit-count', 'proxy-rewrite', 'cors', 'request-id']) {
    await expect(main.getByRole('group', { name, exact: true }).getByRole('button', { name: new RegExp(`^${name}\\b`) }).first()).toHaveAttribute('aria-expanded', 'true');
  }
  // The locked cards are shorter than the editing ones (no help lines), and the browser keeps what was
  // on screen in place, so the offset may shrink a little; it must not go back to the top, and the card
  // that was being edited is still on screen.
  const after = await scrollTop(main);
  expect(after).toBeGreaterThan(before / 2);
  const view = (await main.boundingBox())!;
  const card = (await cors.boundingBox())!;
  expect(card.y < view.y + view.height && card.y + card.height > view.y, 'the cors card is still in view').toBe(true);
});
