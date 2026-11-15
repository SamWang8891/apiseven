import {
  Admin,
  ECHO,
  addPlugin,
  codeText,
  echoRoute,
  expect,
  gateway,
  gatewayAnswers,
  eventually,
  openEditor,
  pluginCard,
  recordWrites,
  save,
  t,
  tabNamed,
  test,
  toast,
  uid,
  unlock,
} from './fixtures';

const PREFIX = 'e2e-plug-';

test.afterAll(async () => {
  await new Admin().removePrefixed(PREFIX);
});

async function storedRoute(admin: Admin, extra: Record<string, unknown> = {}) {
  const id = `${PREFIX}${uid()}`;
  const host = `${id}.e2e.test`;
  await admin.put(`routes/${id}`, echoRoute(id, host, extra));
  return { id, host };
}

test('limit-count added in the form: the JSON view shows the same values, and the third request is refused with the configured code', async ({ page, admin }) => {
  const { id, host } = await storedRoute(admin);
  await gatewayAnswers(host, 200);
  await openEditor(page, `routes/${id}?tab=plugins`);
  await unlock(page);
  const card = await addPlugin(page, 'limit-count');
  await card.getByRole('textbox', { name: /^count\b/ }).fill('2');
  await card.getByRole('textbox', { name: /^time_window\b/ }).fill('60');
  await card.getByRole('spinbutton', { name: 'rejected_code' }).fill('503');
  await card.getByRole('group', { name: t('pl.card.view', { name: 'limit-count' }) }).getByRole('button', { name: t('pl.card.json') }).click();
  const json = card.getByRole('textbox', { name: t('pl.card.jsonLabel', { name: 'limit-count' }) });
  expect(JSON.parse(await codeText(json))).toEqual({ count: 2, time_window: 60, rejected_code: 503 });
  const write = await save(page);
  expect((write.body?.plugins as Record<string, unknown>)['limit-count']).toEqual({ count: 2, time_window: 60, rejected_code: 503 });
  expect((await admin.value(`routes/${id}`))?.plugins).toEqual({ 'limit-count': { count: 2, time_window: 60, rejected_code: 503 } });

  // The first request APISIX counts carries the quota headers; two pass, the third is refused.
  const first = await eventually(
    () => gateway(ECHO.path, { host }),
    (r) => r.headers['x-ratelimit-limit'] === '2',
  );
  expect(first.status).toBe(200);
  expect(first.headers['x-ratelimit-remaining']).toBe('1');
  expect((await gateway(ECHO.path, { host })).status).toBe(200);
  expect((await gateway(ECHO.path, { host })).status).toBe(503);
});

test('switched off on its card, limit-count no longer limits', async ({ page, admin }) => {
  const { id, host } = await storedRoute(admin, { plugins: { 'limit-count': { count: 1, time_window: 60, rejected_code: 503 } } });
  await eventually(
    () => gateway(ECHO.path, { host }),
    (r) => r.status === 503,
  );
  await openEditor(page, `routes/${id}?tab=plugins`);
  await unlock(page);
  await pluginCard(page, 'limit-count').getByRole('switch', { name: t('pl.card.enable', { name: 'limit-count' }) }).click();
  const write = await save(page);
  expect((write.body?.plugins as Record<string, Record<string, unknown>>)['limit-count']?._meta).toEqual({ disable: true });
  await gatewayAnswers(host, 200);
  for (let i = 0; i < 3; i++) expect((await gateway(ECHO.path, { host })).status).toBe(200);
});

test('proxy-rewrite and cors added in their forms: the stored JSON is what was entered, and the gateway applies both', async ({ page, admin }) => {
  const { id, host } = await storedRoute(admin);
  await openEditor(page, `routes/${id}?tab=plugins`);
  await unlock(page);
  const rewrite = await addPlugin(page, 'proxy-rewrite');
  await rewrite.getByRole('textbox', { name: /^uri\b/ }).fill('/health');
  const cors = await addPlugin(page, 'cors');
  await cors.getByRole('textbox', { name: /^allow_origins\b/ }).fill('https://e2e.test');
  await save(page);
  expect((await admin.value(`routes/${id}`))?.plugins).toEqual({
    'proxy-rewrite': { uri: '/health' },
    cors: { allow_origins: 'https://e2e.test' },
  });
  // etcd answers /health instead of /version, and the CORS header names the origin.
  const reply = await eventually(
    () => gateway(ECHO.path, { host, headers: { Origin: 'https://e2e.test' } }),
    (r) => r.text.includes('"health"'),
  );
  expect(reply.text).toContain('"health"');
  expect(reply.headers['access-control-allow-origin']).toBe('https://e2e.test');
});

test('a missing required field blocks Save (nothing is sent), the toast counts the problems, and the Plugins tab is badged', async ({ page, admin }) => {
  const { id } = await storedRoute(admin);
  const stored = await admin.value(`routes/${id}`);
  await openEditor(page, `routes/${id}?tab=plugins`);
  await unlock(page);
  const card = await addPlugin(page, 'limit-count');
  await expect(card).toContainText(t('pl.card.problems.many', { count: 2 }));
  await expect(tabNamed(page, t('pl.tab'))).toHaveAccessibleName(`${t('pl.tab')} ${t('ui.tabs.errors', { count: 2 })}`);
  const writes = recordWrites(page);
  await page.getByRole('main').getByRole('button', { name: t('editor.save'), exact: true }).click();
  await expect(toast(page, t('editor.fixMany', { count: 2 }))).toBeVisible();
  expect(writes).toEqual([]);
  expect(await admin.value(`routes/${id}`)).toEqual(stored);
  // Filled in, the badge goes and the save goes through.
  await card.getByRole('textbox', { name: /^count\b/ }).fill('10');
  await card.getByRole('textbox', { name: /^time_window\b/ }).fill('60');
  await expect(tabNamed(page, t('pl.tab'))).toHaveAccessibleName(t('pl.tab'));
  await save(page);
  expect((await admin.value(`routes/${id}`))?.plugins).toEqual({ 'limit-count': { count: 10, time_window: 60 } });
});

test('key-auth on a consumer asks for its key (on a route it has none)', async ({ page, admin }) => {
  const username = `${PREFIX}${uid()}`.replace(/-/g, '_');
  await admin.put('consumers', { username });
  await openEditor(page, `consumers/${username}?tab=plugins`);
  await unlock(page);
  const card = await addPlugin(page, 'key-auth');
  const key = card.getByRole('textbox', { name: /^key\b(?!-)/ });
  await expect(key).toBeVisible();
  await expect(key).toHaveAttribute('aria-invalid', 'true');
  const writes = recordWrites(page);
  await page.getByRole('main').getByRole('button', { name: t('editor.save'), exact: true }).click();
  await expect(toast(page, t('editor.fixOne'))).toBeVisible();
  expect(writes).toEqual([]);
  await key.fill('e2e-consumer-key');
  await save(page);
  expect(((await admin.value(`consumers/${username}`))?.plugins as Record<string, unknown>)['key-auth']).toEqual({ key: 'e2e-consumer-key' });
  await admin.del(`consumers/${username}`);

  // A route's key-auth has no key field.
  const { id } = await storedRoute(admin);
  await openEditor(page, `routes/${id}?tab=plugins`);
  await unlock(page);
  const routeCard = await addPlugin(page, 'key-auth');
  await expect(routeCard.getByRole('textbox', { name: /^key\b(?!-)/ })).toHaveCount(0);
});

test('every plugin the picker offers for a route can be added and its card opened without a console error', async ({ page, admin }) => {
  test.setTimeout(600_000);
  const { id } = await storedRoute(admin);
  await openEditor(page, `routes/${id}?tab=plugins`);
  await unlock(page);
  const main = page.getByRole('main');
  await main.getByRole('button', { name: t('pl.add'), exact: true }).click();
  const picker = page.getByRole('dialog', { name: t('pl.picker.title') });
  const listing = await picker.getByRole('listbox').ariaSnapshot();
  const names = [...listing.matchAll(/- option "([^"]+)"/g)].map((m) => m[1]!);
  expect(names.length).toBeGreaterThan(60);
  await page.keyboard.press('Escape');
  for (const name of names) {
    const card = await addPlugin(page, name);
    // The card shows its body: a form, a JSON view or the note saying why there is none.
    await expect(card.getByRole('group', { name: t('pl.card.view', { name }) }).or(card.getByText(t('pl.card.noForm', { name })))).toBeVisible();
    await card.getByRole('button', { name: t('pl.card.remove', { name }) }).click();
    await expect(pluginCard(page, name)).toHaveCount(0);
  }
  // Nothing was saved.
  await main.getByRole('button', { name: t('editor.discard'), exact: true }).click();
  const ask = page.getByRole('alertdialog', { name: t('editor.leave.title') });
  if (await ask.isVisible()) await ask.getByRole('button', { name: t('editor.leave.confirm') }).click();
  await expect(main.getByRole('button', { name: t('editor.edit'), exact: true })).toBeVisible();
  expect((await admin.value(`routes/${id}`))?.plugins).toBeUndefined();
});
