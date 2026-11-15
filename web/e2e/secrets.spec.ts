// Secrets fail closed (addendum rules 5, 19 and the Task 13 rulings): a credential's key, an upstream's
// TLS client key and a consumer's key are never in the page unless revealed, never come back after a
// Save, and a save that does not touch them leaves them as they are. The SSL private key is in
// ssl.spec.ts.
import { EC_PAIR } from '../src/test/pairs';
import {
  Admin,
  echoRoute,
  echoUpstream,
  expect,
  gateway,
  gatewayAnswers,
  openCard,
  openEditor,
  openList,
  openTab,
  save,
  t,
  test,
  toast,
  uid,
  unlock,
} from './fixtures';

const PREFIX = 'e2e-sec-';
const CREDENTIAL = t('kind.credentials.singular');

test.afterAll(async () => {
  await new Admin().removePrefixed(PREFIX);
});

/** A consumer with one key-auth credential, and a route that signs requests in with key-auth. */
async function signedIn(admin: Admin) {
  const id = uid();
  const username = `${PREFIX}${id}`.replace(/-/g, '_');
  const credential = `${PREFIX}cred-${id}`;
  const key = `${PREFIX}key-${id}-${uid()}`;
  const host = `${PREFIX}${id}.e2e.test`;
  await admin.put('consumers', { username });
  await admin.put(`consumers/${username}/credentials/${credential}`, { name: credential, plugins: { 'key-auth': { key } } });
  await admin.put(`routes/${PREFIX}${id}`, echoRoute(`${PREFIX}${id}`, host, { plugins: { 'key-auth': {} } }));
  await gatewayAnswers(host, 200, { headers: { apikey: key } });
  return { username, credential, key, host, path: `consumers/${username}/credentials/${credential}` };
}

async function html(page: import('@playwright/test').Page): Promise<string> {
  return page.content();
}

test.describe('a credential’s key', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('is nowhere in the page while locked (form, card, JSON tab, View JSON) until revealed, and masked again after a Save', async ({ page, admin }) => {
    const { key, path } = await signedIn(admin);
    const main = await openEditor(page, path);
    expect(await html(page)).not.toContain(key);
    await openTab(page, t('pl.tab'));
    const card = await openCard(page, 'key-auth');
    await expect(card).toContainText('••••••••');
    expect(await html(page)).not.toContain(key);
    await openTab(page, t('editor.json.tab'));
    expect(await html(page)).not.toContain(key);
    await main.getByRole('button', { name: t('editor.more') }).click();
    await page.getByRole('menuitem', { name: t('action.viewJson') }).click();
    const view = page.getByRole('dialog', { name: new RegExp(`as JSON$`) });
    await expect(view).toBeVisible();
    expect(await html(page)).not.toContain(key);
    // Copy while masked says it copied masks, and the clipboard holds no key.
    await view.getByRole('button', { name: t('json.copy') }).click();
    await expect(toast(page, t('json.copiedMasked'))).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).not.toContain(key);
    // Revealed on request.
    await view.getByRole('button', { name: t('pl.card.secrets.show') }).click();
    await expect(view).toContainText(key);
    await view.getByRole('button', { name: t('ui.close') }).first().click();

    // Edit the description only, save: the key is masked again everywhere.
    await unlock(page);
    await openTab(page, t('cr.tab.general'));
    await main.getByRole('textbox', { name: t('cr.general.desc') }).fill('description only');
    const write = await save(page);
    expect(((write.body?.plugins as Record<string, Record<string, unknown>>)['key-auth'])?.key).toBe(key);
    expect(await html(page)).not.toContain(key);
    await openTab(page, t('pl.tab'));
    await openCard(page, 'key-auth');
    expect(await html(page)).not.toContain(key);
  });

  test('a description-only edit leaves the key working at the gateway: the old key 200, a wrong one 401', async ({ page, admin }) => {
    const { key, host, path } = await signedIn(admin);
    const main = await openEditor(page, path);
    await unlock(page);
    await main.getByRole('textbox', { name: t('cr.general.desc') }).fill('renamed nothing, changed the description');
    await save(page);
    expect((await admin.value(path))?.desc).toBe('renamed nothing, changed the description');
    await gatewayAnswers(host, 200, { headers: { apikey: key } });
    expect((await gateway('/version', { host, headers: { apikey: 'wrong-key' } })).status).toBe(401);
  });

  test('the conflict dialog shows no key until revealed; Overwrite stores the key the editor holds', async ({ page, admin }) => {
    const { key, host, path } = await signedIn(admin);
    const theirs = `${PREFIX}theirs-${uid()}`;
    const main = await openEditor(page, path);
    await unlock(page);
    await main.getByRole('textbox', { name: t('cr.general.desc') }).fill('mine');
    // Credentials take no PATCH: theirs is a whole PUT.
    await admin.put(path, { name: path.split('/').pop(), desc: 'theirs', plugins: { 'key-auth': { key: theirs } } });
    await main.getByRole('button', { name: t('editor.save'), exact: true }).click();
    const dialog = page.getByRole('dialog', { name: t('editor.conflict.title', { kind: CREDENTIAL, name: path.split('/').pop()! }) });
    await expect(dialog).toBeVisible();
    // Neither key is in the page; the changed one is marked as changed.
    const content = await html(page);
    expect(content).not.toContain(key);
    expect(content).not.toContain(theirs);
    await expect(dialog).toContainText('(changed)');
    await dialog.getByRole('button', { name: t('pl.card.secrets.show') }).click();
    await expect(dialog).toContainText(key);
    await expect(dialog).toContainText(theirs);
    await dialog.getByRole('button', { name: t('editor.conflict.overwrite') }).click();
    await expect(main.getByRole('button', { name: t('editor.edit'), exact: true })).toBeVisible();
    const stored = await admin.value(path);
    expect(stored?.desc).toBe('mine');
    expect((stored?.plugins as Record<string, Record<string, unknown>>)['key-auth']?.key).toBe(key);
    await gatewayAnswers(host, 200, { headers: { apikey: key } });
    expect((await gateway('/version', { host, headers: { apikey: theirs } })).status).toBe(401);
  });
});

test.describe('an upstream’s TLS client key', () => {
  const keyLine = EC_PAIR.key.split('\n')[2]!;

  test('Replace key → Save → "set, not shown", no key text, also in the next Edit; Keep the stored key → Save changes nothing', async ({ page, admin }) => {
    const id = `${PREFIX}up-${uid()}`;
    await admin.put(`upstreams/${id}`, { name: id, scheme: 'https', ...echoUpstream(), tls: { client_cert: EC_PAIR.cert, client_key: EC_PAIR.key } });
    const stored = await admin.must(`upstreams/${id}`);
    const main = await openEditor(page, `upstreams/${id}?tab=tls`);
    await expect(main.getByRole('tabpanel')).toContainText(t('up.tls.keyStored'));
    expect(await html(page)).not.toContain(keyLine);

    await unlock(page);
    await main.getByRole('button', { name: t('up.tls.replaceKey') }).click();
    await main.getByRole('textbox', { name: t('up.tls.key') }).fill(EC_PAIR.key);
    const write = await save(page);
    expect((write.body?.tls as Record<string, unknown>).client_key).toBe(EC_PAIR.key);
    await expect(main.getByRole('tabpanel')).toContainText(t('up.tls.keyStored'));
    expect(await html(page)).not.toContain(keyLine);
    await unlock(page);
    await expect(main.getByRole('tabpanel')).toContainText(t('up.tls.keyStored'));
    await expect(main.getByRole('textbox', { name: t('up.tls.key') })).toHaveCount(0);
    expect(await html(page)).not.toContain(keyLine);

    // Start a replacement, then keep the stored key: the save sends the stored key back unchanged.
    const before = await admin.must(`upstreams/${id}`);
    await main.getByRole('button', { name: t('up.tls.replaceKey') }).click();
    await main.getByRole('textbox', { name: t('up.tls.key') }).fill('-----BEGIN PRIVATE KEY-----\nnot used\n');
    await main.getByRole('button', { name: t('up.tls.keepKey') }).click();
    await openTab(page, t('up.tab.general'));
    await main.getByRole('textbox', { name: t('up.general.desc') }).fill('kept the key');
    await save(page);
    expect(await admin.value(`upstreams/${id}`)).toEqual({ ...before, desc: 'kept the key' });
    expect(stored.tls).toBeDefined();
  });
});

test.describe('search', () => {
  async function consumerWithKey(admin: Admin) {
    const username = `${PREFIX}${uid()}`.replace(/-/g, '_');
    const key = `${PREFIX}search-key-${uid()}`;
    await admin.put('consumers', { username, plugins: { 'key-auth': { key } } });
    return { username, key };
  }

  // Task 16b item 72 (verify-only there): the list's search text leaves out every secret field.
  test.fixme('16b-72: the consumers list search does not find a consumer by its key', async ({ page, admin }) => {
    const { username, key } = await consumerWithKey(admin);
    const main = await openList(page, 'consumers');
    await expect(main.getByRole('link', { name: username, exact: true })).toBeVisible();
    const search = main.getByRole('searchbox', { name: t('table.search.label', { plural: t('kind.consumers.plural') }) });
    await search.fill(key);
    await expect(main.getByText(t('table.empty.noMatch', { plural: t('kind.consumers.plural') }))).toBeVisible();
    await search.fill(username);
    await expect(main.getByRole('link', { name: username, exact: true })).toBeVisible();
  });

  test('the command palette does not find a consumer by its key, only by its username', async ({ page, admin }) => {
    const { username, key } = await consumerWithKey(admin);
    await openList(page, 'consumers');
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: t('palette.title') });
    const box = palette.getByRole('combobox', { name: t('palette.input') });
    await box.fill(username);
    await expect(palette.getByRole('option', { name: new RegExp(username) }).first()).toBeVisible();
    await box.fill(key);
    await expect(palette.getByText(/^Nothing matches/).first()).toBeVisible();
    await expect(palette.getByRole('option', { name: new RegExp(username) })).toHaveCount(0);
  });
});
