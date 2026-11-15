// Secrets fail closed (addendum rules 5, 19 and the Task 13 rulings): a credential's key, an upstream's
// TLS client key and a consumer's key are never in the page unless revealed, never come back after a
// Save, and a save that does not touch them leaves them as they are. The SSL private key is in
// ssl.spec.ts. No assertion here takes a secret as its argument: each checks only whether the page
// (pageHolds: markup, form values, code editors' whole text, accessible text) holds it, so a failure
// never prints one.
import type { Locator, Page } from '@playwright/test';
import { MASK_CHANGED } from '../src/plugins/secrets';
import { MASK } from '../src/schema/secrets';
import { EC_PAIR, RSA_PAIR } from '../src/test/pairs';
import {
  Admin,
  codeText,
  echoRoute,
  echoUpstream,
  expect,
  expectNoCredentials,
  expectNotInPage,
  expectSameQuietly,
  gateway,
  gatewayAnswers,
  holdsIn,
  jsonEditor,
  openCard,
  openEditor,
  openList,
  openTab,
  pageHolds,
  save,
  setCode,
  t,
  test,
  toast,
  uid,
  unlock,
  type Json,
} from './fixtures';

const PREFIX = 'e2e-sec-';
const CREDENTIAL = t('kind.credentials.singular');
const SHOW_SECRETS = t('pl.card.secrets.show');

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

/** Whether the page holds the secret (never the secret itself in a message). */
async function holds(page: Page, secret: string): Promise<boolean> {
  return (await pageHolds(page)).includes(secret);
}

/** The key-auth card's view switch: Form or JSON. */
async function cardView(card: Locator, view: 'form' | 'json'): Promise<void> {
  await card.getByRole('group', { name: t('pl.card.view', { name: 'key-auth' }) }).getByRole('button', { name: t(view === 'json' ? 'pl.card.json' : 'pl.card.form'), exact: true }).click();
}

const keyOf = (value: Json | undefined) => ((value?.plugins as Record<string, Json> | undefined)?.['key-auth'])?.key;

test.describe('a credential’s key', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('is nowhere in the page while locked (form, card, JSON tab, View JSON) until revealed; Copy while masked says so', async ({ page, admin }) => {
    const { key, path } = await signedIn(admin);
    const main = await openEditor(page, path);
    await expectNotInPage(page, [key], 'General, locked');
    await openTab(page, t('pl.tab'));
    const card = await openCard(page, 'key-auth');
    await expect(card).toContainText(MASK);
    await expectNotInPage(page, [key], 'the card, locked');
    await openTab(page, t('editor.json.tab'));
    await expectNotInPage(page, [key], 'the JSON tab, locked');
    await main.getByRole('button', { name: t('editor.more') }).click();
    await page.getByRole('menuitem', { name: t('action.viewJson') }).click();
    const view = page.getByRole('dialog', { name: t('json.title', { kind: CREDENTIAL, name: path.split('/').pop()! }) });
    await expect(view).toBeVisible();
    await expectNotInPage(page, [key], 'View JSON');
    // Copy while masked says it copied masks, and the clipboard holds no key.
    await view.getByRole('button', { name: t('json.copy') }).click();
    await expect(toast(page, t('json.copiedMasked'))).toBeVisible();
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard.includes(key), 'the copied JSON holds the key').toBe(false);
    // Revealed on request.
    await view.getByRole('button', { name: SHOW_SECRETS }).click();
    expect(await holds(page, key), 'View JSON shows the key once revealed').toBe(true);
    await view.getByRole('button', { name: t('ui.close') }).first().click();
  });

  test('revealed on the JSON tab, then edited there and saved: masked again when locked', async ({ page, admin }) => {
    const { key, path } = await signedIn(admin);
    const main = await openEditor(page, `${path}?tab=json`);
    await main.getByRole('tabpanel').getByRole('button', { name: SHOW_SECRETS }).click();
    expect(await holds(page, key), 'the JSON tab shows the key once revealed').toBe(true);
    // Edit: the JSON tab is the text Save sends, key included; change the description in it.
    await unlock(page);
    const json = jsonEditor(page, CREDENTIAL);
    const text = JSON.parse(await codeText(json)) as Json;
    expect(keyOf(text) === key, 'the editing JSON holds the key').toBe(true);
    await setCode(page, json, JSON.stringify({ ...text, desc: 'saved from the JSON tab' }, null, 2));
    const write = await save(page);
    expect(keyOf(write.body) === key, 'the save sends the stored key unchanged').toBe(true);
    // Locked again, still on the JSON tab: masked, with Show secrets offered again.
    await expect(main.getByRole('tab', { name: t('editor.json.tab') })).toHaveAttribute('aria-selected', 'true');
    await expect(main.getByRole('tabpanel').getByRole('button', { name: SHOW_SECRETS })).toBeVisible();
    await expectNotInPage(page, [key], 'the JSON tab, after the Save');
    expect((await admin.value(path))?.desc).toBe('saved from the JSON tab');
  });

  test('revealed on the card’s JSON view, then a new key entered there and saved: masked again when locked, and not revealed in the next Edit', async ({ page, admin }) => {
    const { key, path } = await signedIn(admin);
    const fresh = `${PREFIX}new-key-${uid()}`;
    const main = await openEditor(page, `${path}?tab=plugins`);
    const card = await openCard(page, 'key-auth');
    await cardView(card, 'json');
    await card.getByRole('button', { name: SHOW_SECRETS }).click();
    expect(await holds(page, key), "the card's JSON view shows the key once revealed").toBe(true);

    await unlock(page);
    const json = card.getByRole('textbox', { name: t('pl.card.jsonLabel', { name: 'key-auth' }) });
    expect(await holds(page, key), "the editing card's JSON holds the key").toBe(true);
    await setCode(page, json, JSON.stringify({ key: fresh }));
    const write = await save(page);
    expect(keyOf(write.body) === fresh, 'the save sends the new key').toBe(true);

    // Locked again, on the same tab with the card still in its JSON view: masked, Show secrets offered.
    await expect(card.getByRole('button', { name: SHOW_SECRETS })).toBeVisible();
    await expectNotInPage(page, [key, fresh], "the card's JSON view, after the Save");
    await cardView(card, 'form');
    await expectNotInPage(page, [key, fresh], 'the card form, after the Save');
    await openTab(page, t('editor.json.tab'));
    await expectNotInPage(page, [key, fresh], 'the JSON tab, after the Save');

    // The next Edit starts unrevealed: the key field is a password field.
    await unlock(page);
    await openTab(page, t('pl.tab'));
    const again = await openCard(page, 'key-auth');
    await cardView(again, 'form');
    await expect(again.getByRole('textbox', { name: /^key\b(?!-)/ })).toHaveAttribute('type', 'password');
    await main.getByRole('button', { name: t('editor.discard'), exact: true }).click();
    await expect(main.getByRole('button', { name: t('editor.edit'), exact: true })).toBeVisible();
    await expectNotInPage(page, [key, fresh], 'locked again after the next Edit');
    expect(keyOf(await admin.value(path)) === fresh, 'APISIX holds the new key').toBe(true);
  });

  test('a description-only edit leaves the key working at the gateway: the old key 200, a wrong one 401', async ({ page, admin }) => {
    const { key, host, path } = await signedIn(admin);
    const before = await admin.must(path);
    const main = await openEditor(page, path);
    await unlock(page);
    await main.getByRole('textbox', { name: t('cr.general.desc') }).fill('renamed nothing, changed the description');
    await save(page);
    expectSameQuietly(await admin.value(path), { ...before, desc: 'renamed nothing, changed the description' }, 'the credential after a description edit');
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
    // Neither key is in the page; the changed one is marked as changed. (The editor behind the dialog
    // holds mine in its form, so for mine only the dialog is checked: its markup and attributes, its
    // code views' whole text, and its accessible tree.)
    expect((await holdsIn(dialog)).includes(key), 'the dialog holds my key').toBe(false);
    expect(await holds(page, theirs), 'the page holds their key').toBe(false);
    await expect(dialog).toContainText(MASK_CHANGED);
    await dialog.getByRole('button', { name: SHOW_SECRETS }).click();
    expect((await dialog.innerText()).includes(key), 'the dialog shows my key once revealed').toBe(true);
    expect((await dialog.innerText()).includes(theirs), 'the dialog shows their key once revealed').toBe(true);
    await dialog.getByRole('button', { name: t('editor.conflict.overwrite') }).click();
    await expect(main.getByRole('button', { name: t('editor.edit'), exact: true })).toBeVisible();
    const stored = await admin.value(path);
    expect(stored?.desc).toBe('mine');
    expect(keyOf(stored) === key, 'Overwrite stored the key the editor holds').toBe(true);
    await gatewayAnswers(host, 200, { headers: { apikey: key } });
    expect((await gateway('/version', { host, headers: { apikey: theirs } })).status).toBe(401);
  });
});

test.describe('an upstream’s TLS client key', () => {
  const lines = [EC_PAIR.key.split('\n')[2]!, RSA_PAIR.key.split('\n')[5]!];

  test('Replace with another certificate and key → Save → "set, not shown", no key text, also in the next Edit; Keep the stored key → Save changes nothing', async ({ page, admin }) => {
    const id = `${PREFIX}up-${uid()}`;
    await admin.put(`upstreams/${id}`, { name: id, scheme: 'https', ...echoUpstream(), tls: { client_cert: EC_PAIR.cert, client_key: EC_PAIR.key } });
    const stored = await admin.must(`upstreams/${id}`);
    const storedKey = (stored.tls as Json).client_key;
    const main = await openEditor(page, `upstreams/${id}?tab=tls`);
    await expect(main.getByRole('tabpanel')).toContainText(t('up.tls.keyStored'));
    await expectNotInPage(page, lines, 'TLS, locked');

    await unlock(page);
    await main.getByRole('textbox', { name: t('up.tls.cert') }).fill(RSA_PAIR.cert);
    await main.getByRole('button', { name: t('up.tls.replaceKey') }).click();
    await main.getByRole('textbox', { name: t('up.tls.key') }).fill(RSA_PAIR.key);
    const write = await save(page);
    const sent = write.body?.tls as Json;
    expect(sent.client_cert === RSA_PAIR.cert && sent.client_key === RSA_PAIR.key, 'the save sends the new certificate and key').toBe(true);
    const after = (await admin.must(`upstreams/${id}`)).tls as Json;
    expect(after.client_cert === RSA_PAIR.cert, 'APISIX holds the new certificate').toBe(true);
    // APISIX keeps the key encrypted: the stored text is new, and is not the old key's.
    expect(typeof after.client_key === 'string' && after.client_key !== storedKey, 'APISIX holds a new key').toBe(true);
    await expect(main.getByRole('tabpanel')).toContainText(t('up.tls.keyStored'));
    await expectNotInPage(page, lines, 'TLS, after the Save');
    await unlock(page);
    await expect(main.getByRole('tabpanel')).toContainText(t('up.tls.keyStored'));
    await expect(main.getByRole('textbox', { name: t('up.tls.key') })).toHaveCount(0);
    await expectNotInPage(page, lines, 'TLS, the next Edit');

    // Start a replacement, then keep the stored key: the save sends the stored key back unchanged.
    const before = await admin.must(`upstreams/${id}`);
    await main.getByRole('button', { name: t('up.tls.replaceKey') }).click();
    await main.getByRole('textbox', { name: t('up.tls.key') }).fill('-----BEGIN PRIVATE KEY-----\nnot used\n');
    await main.getByRole('button', { name: t('up.tls.keepKey') }).click();
    await openTab(page, t('up.tab.general'));
    await main.getByRole('textbox', { name: t('up.general.desc') }).fill('kept the key');
    await save(page);
    expectSameQuietly(await admin.value(`upstreams/${id}`), { ...before, desc: 'kept the key' }, 'the upstream after Keep the stored key');
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
    expectNoCredentials(page, username);
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
    expectNoCredentials(page, username);
    await openList(page, 'consumers');
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: t('palette.title') });
    const box = palette.getByRole('combobox', { name: t('palette.input') });
    await box.fill(username);
    await expect(palette.getByRole('option', { name: username, exact: true })).toBeVisible();
    await box.fill(key);
    // "Nothing matches “<the key>”.": matched by what comes before the query, so no key is printed.
    const nothing = t('palette.noResults', { query: '\u0000' }).split('\u0000')[0]!;
    await expect(palette.getByText(new RegExp(`^${nothing.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)).first()).toBeVisible();
    await expect(palette.getByRole('option', { name: username, exact: true })).toHaveCount(0);
  });
});
