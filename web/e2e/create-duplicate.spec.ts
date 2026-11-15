// Create never overwrites (addendum rule 17), and a copy never carries the original's secrets. A
// route's plain Duplicate is in route-editor.spec.ts.
import type { Page } from '@playwright/test';
import {
  Admin,
  ECHO,
  banner,
  create,
  echoRoute,
  expect,
  goto,
  jsonEditor,
  openCard,
  openEditor,
  openNew,
  openTab,
  recordWrites,
  setCode,
  t,
  test,
  toast,
  uid,
} from './fixtures';

const PREFIX = 'e2e-new-';

test.afterAll(async () => {
  await new Admin().removePrefixed(PREFIX);
});

/** Create is refused: the "Not created" banner links to the stored object, and nothing was written. */
async function expectNotCreated(page: Page, kind: string, id: string, href: string, writes: unknown[]) {
  await expect(banner(page)).toContainText(t('editor.taken.title'));
  await expect(banner(page)).toContainText(t('editor.taken.message', { kind, id }));
  await expect(banner(page).getByRole('link', { name: t('editor.taken.open', { kind, id }) })).toHaveAttribute('href', href);
  expect(writes).toEqual([]);
}

test.describe('Create never replaces what is stored', () => {
  test('New consumer with a username that exists: refused, with a link; the stored consumer is untouched', async ({ page, admin }) => {
    const username = `${PREFIX}${uid()}`.replace(/-/g, '_');
    await admin.put('consumers', { username, desc: 'the stored one', plugins: { 'key-auth': { key: `${PREFIX}${uid()}` } } });
    const before = await admin.item(`consumers/${username}`);
    const main = await goto(page, 'consumers/new');
    await main.getByRole('textbox', { name: /^Username/ }).fill(username);
    await main.getByRole('textbox', { name: t('cs.general.desc') }).fill('would replace it');
    const writes = recordWrites(page);
    await main.getByRole('button', { name: t('editor.create'), exact: true }).click();
    await expectNotCreated(page, t('kind.consumers.singular'), username, `#/consumers/${username}`, writes);
    expect(await admin.item(`consumers/${username}`)).toEqual(before);
  });

  test('New route with an ID that exists: refused, with a link; the stored route is untouched', async ({ page, admin }) => {
    const id = `${PREFIX}${uid()}`;
    await admin.put(`routes/${id}`, echoRoute(id, `${id}.e2e.test`, { desc: 'the stored one' }));
    const before = await admin.item(`routes/${id}`);
    const main = await goto(page, 'routes/new');
    await main.getByRole('textbox', { name: t('editor.id.label'), exact: true }).fill(id);
    const panel = await openTab(page, t('rt.tab.upstream'));
    await panel.getByRole('textbox', { name: t('up.nodes.new') }).fill(ECHO.host);
    const writes = recordWrites(page);
    await main.getByRole('button', { name: t('editor.create'), exact: true }).click();
    await expectNotCreated(page, t('kind.routes.singular'), id, `#/routes/${id}`, writes);
    expect(await admin.item(`routes/${id}`)).toEqual(before);
  });

  test('New credential with an ID that exists: refused, with a link; the stored credential is untouched', async ({ page, admin }) => {
    const username = `${PREFIX}${uid()}`.replace(/-/g, '_');
    const credential = `${PREFIX}cred`;
    await admin.put('consumers', { username });
    await admin.put(`consumers/${username}/credentials/${credential}`, { plugins: { 'key-auth': { key: `${PREFIX}${uid()}` } } });
    const before = await admin.item(`consumers/${username}/credentials/${credential}`);
    const main = await goto(page, `consumers/${username}/credentials/new`);
    await main.getByRole('textbox', { name: new RegExp(`^${t('editor.id.label')}\\b`) }).fill(credential);
    const writes = recordWrites(page);
    await main.getByRole('button', { name: t('editor.create'), exact: true }).click();
    await expectNotCreated(page, t('kind.credentials.singular'), credential, `#/consumers/${username}/credentials/${credential}`, writes);
    expect(await admin.item(`consumers/${username}/credentials/${credential}`)).toEqual(before);
  });
});

test.describe('a copy of a consumer with three auth plugins', () => {
  test('the notice names what was not copied and what is still shared; no secret is in the page; Create waits for the copy’s own', async ({ page, admin }) => {
    const id = uid();
    const username = `${PREFIX}${id}`.replace(/-/g, '_');
    const secrets = { key: `${PREFIX}k-${id}`, password: `${PREFIX}p-${id}`, jwtSecret: `${PREFIX}jwt-secret-${id}-0123456789` };
    await admin.put('consumers', {
      username,
      plugins: {
        'key-auth': { key: secrets.key },
        'basic-auth': { username: `${PREFIX}basic-${id}`, password: secrets.password },
        'jwt-auth': { key: `${PREFIX}jwt-${id}`, secret: secrets.jwtSecret },
      },
    });
    const original = await admin.item(`consumers/${username}`);
    const main = await openEditor(page, `consumers/${username}`);
    await main.getByRole('button', { name: t('editor.more') }).click();
    await page.getByRole('menuitem', { name: t('action.duplicate') }).click();
    const notice = main.getByRole('note', { name: t('editor.copyNotice.title') });
    await expect(notice).toBeVisible();
    for (const notCopied of ['basic-auth password', 'jwt-auth secret', 'key-auth key']) await expect(notice).toContainText(notCopied);
    for (const shared of ['basic-auth username', 'jwt-auth key']) await expect(notice).toContainText(shared);
    const html = await page.content();
    for (const secret of Object.values(secrets)) expect(html).not.toContain(secret);

    // Create is refused while the copy has no key and password of its own.
    const copy = `${PREFIX}copy-${id}`.replace(/-/g, '_');
    await main.getByRole('textbox', { name: /^Username/ }).fill(copy);
    const writes = recordWrites(page);
    await main.getByRole('button', { name: t('editor.create'), exact: true }).click();
    await expect(toast(page, t('editor.fixMany', { count: 2 }))).toBeVisible();
    expect(writes).toEqual([]);

    await openTab(page, t('pl.tab'));
    const keyAuth = await openCard(page, 'key-auth');
    await keyAuth.getByRole('textbox', { name: /^key\b(?!-)/ }).fill(`${PREFIX}own-key-${id}`);
    const basic = await openCard(page, 'basic-auth');
    await basic.getByRole('textbox', { name: /^username\b/ }).fill(`${PREFIX}own-basic-${id}`);
    await basic.getByRole('textbox', { name: /^password\b/ }).fill(`${PREFIX}own-password-${id}`);
    const jwt = await openCard(page, 'jwt-auth');
    await jwt.getByRole('textbox', { name: /^key\b(?!-)/ }).fill(`${PREFIX}own-jwt-${id}`);
    // APISIX also needs a secret for jwt-auth's default algorithm (its own check, beyond the schema).
    await jwt.getByRole('textbox', { name: /^secret\b/ }).fill(`${PREFIX}own-jwt-secret-${id}-0123456789`);
    await create(page);
    const stored = (await admin.value(`consumers/${copy}`))?.plugins as Record<string, Record<string, unknown>>;
    expect(stored['key-auth']).toEqual({ key: `${PREFIX}own-key-${id}` });
    expect(stored['basic-auth']).toEqual({ username: `${PREFIX}own-basic-${id}`, password: `${PREFIX}own-password-${id}` });
    expect(stored['jwt-auth']).toEqual({ key: `${PREFIX}own-jwt-${id}`, secret: `${PREFIX}own-jwt-secret-${id}-0123456789` });
    expect(await admin.item(`consumers/${username}`)).toEqual(original);
  });
});

// Task 16b item 142: an id of "" in a new object's JSON is the frame's to refuse (no request, the ID named).
test.describe('an empty id in a new object’s JSON', () => {
  for (const [kind, label, path] of [
    ['routes', t('kind.routes.singular'), 'routes/new?tab=json'],
    ['global_rules', t('kind.global_rules.singular'), 'global_rules/new?tab=json'],
  ] as const) {
    test.fixme(`16b-142: a new ${label} with "id": "" is refused before any request, naming the ID`, async ({ page }) => {
      const main = await goto(page, path);
      const body = kind === 'routes' ? { id: '', uri: ECHO.path, upstream: { nodes: [{ host: ECHO.host, port: ECHO.port, weight: 1 }] } } : { id: '', plugins: { 'request-id': {} } };
      await setCode(page, jsonEditor(page, label), JSON.stringify(body, null, 2));
      const writes = recordWrites(page);
      await main.getByRole('button', { name: t('editor.create'), exact: true }).click();
      await expect(toast(page, /ID/)).toBeVisible();
      expect(writes).toEqual([]);
    });
  }
});

// Task 16b item 154: a new object shows no "required" problems before its first refused Save.
test.describe('a new object before its first Save', () => {
  test.fixme('16b-154: a new route and a new SSL show no required-field problems or tab badges until Create is refused', async ({ page }) => {
    let main = await openNew(page, 'routes/new');
    await expect(main.getByRole('tab', { name: new RegExp(t('ui.tabs.errors', { count: 1 })) })).toHaveCount(0);
    const writes = recordWrites(page);
    await main.getByRole('button', { name: t('editor.create'), exact: true }).click();
    await expect(main.getByRole('tab', { name: `${t('rt.tab.upstream')} ${t('ui.tabs.errors', { count: 1 })}` })).toBeVisible();
    expect(writes).toEqual([]);

    main = await openNew(page, 'ssls/new');
    await expect(main.getByText(t('ssl.issue.certRequired'))).toHaveCount(0);
    await expect(main.getByRole('tab', { name: /to fix/ })).toHaveCount(0);
    await main.getByRole('button', { name: t('editor.create'), exact: true }).click();
    await expect(main.getByText(t('ssl.issue.certRequired')).first()).toBeVisible();
    await expect(main.getByRole('tab', { name: /to fix/ }).first()).toBeVisible();
    expect(writes).toEqual([]);
  });
});
