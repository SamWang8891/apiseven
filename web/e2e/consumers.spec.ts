import {
  Admin,
  addPlugin,
  create,
  deleteFromEditor,
  echoRoute,
  expect,
  gateway,
  gatewayAnswers,
  idField,
  listShows,
  openEditor,
  openNew,
  openTab,
  save,
  t,
  test,
  uid,
  unlock,
} from './fixtures';

const PREFIX = 'e2e-cons-';
const user = (suffix: string) => `${PREFIX}${suffix}`.replace(/-/g, '_');

test.afterAll(async () => {
  await new Admin().removePrefixed(PREFIX);
});

test('a consumer: created in the form → in the list → edited → deleted', async ({ page, admin }) => {
  const username = user(uid());
  const main = await openNew(page, 'consumers/new');
  await main.getByRole('textbox', { name: new RegExp(`^${t('cs.general.username')}`) }).fill(username);
  await main.getByRole('textbox', { name: t('cs.general.desc') }).fill('made in the form');
  const write = await create(page);
  expect(write.path).toBe(`consumers/${username}`);
  expect(await admin.value(`consumers/${username}`)).toEqual({ username, desc: 'made in the form' });
  await listShows(page, 'consumers', username);

  await openEditor(page, `consumers/${username}`);
  await unlock(page);
  await page.getByRole('main').getByRole('textbox', { name: t('cs.general.desc') }).fill('edited');
  await save(page);
  expect((await admin.value(`consumers/${username}`))?.desc).toBe('edited');

  await deleteFromEditor(page, t('kind.consumers.singular'));
  expect(await admin.value(`consumers/${username}`)).toBeUndefined();
  await listShows(page, 'consumers', username, false);
});

test('a credential: made from the consumer’s Credentials tab, signs in at the gateway (401 without, 200 with its key), edited, deleted', async ({ page, admin }) => {
  const id = uid();
  const username = user(id);
  const credential = `${PREFIX}cred-${id}`;
  const key = `${PREFIX}key-${id}`;
  const host = `${PREFIX}${id}.e2e.test`;
  await admin.put('consumers', { username });
  await admin.put(`routes/${PREFIX}${id}`, echoRoute(`${PREFIX}${id}`, host, { plugins: { 'key-auth': {} } }));
  await gatewayAnswers(host, 401);

  const main = await openEditor(page, `consumers/${username}?tab=credentials`);
  await main.getByRole('link', { name: t('cs.credentials.new') }).first().click();
  await expect(main.getByRole('heading', { level: 1, name: t('page.new', { kind: t('kind.credentials.singular') }) })).toBeVisible();
  await idField(page).fill(credential);
  await openTab(page, t('pl.tab'));
  const card = await addPlugin(page, 'key-auth');
  await card.getByRole('textbox', { name: /^key\b(?!-)/ }).fill(key);
  await create(page);
  expect(await admin.value(`consumers/${username}/credentials/${credential}`)).toEqual({ id: credential, plugins: { 'key-auth': { key } } });
  await gatewayAnswers(host, 200, { headers: { apikey: key } });
  expect((await gateway('/version', { host })).status).toBe(401);
  expect((await gateway('/version', { host, headers: { apikey: `${key}-wrong` } })).status).toBe(401);

  // Listed on the consumer's Credentials tab; the back link leads there.
  await page.getByRole('main').getByRole('link', { name: t('editor.backTo', { kind: t('kind.consumers.singular'), name: username }) }).click();
  await expect(page.getByRole('main').getByRole('tabpanel').getByRole('link', { name: credential, exact: true })).toBeVisible();

  await openEditor(page, `consumers/${username}/credentials/${credential}`);
  await unlock(page);
  await page.getByRole('main').getByRole('textbox', { name: t('cr.general.desc') }).fill('edited');
  await save(page);
  expect((await admin.value(`consumers/${username}/credentials/${credential}`))?.desc).toBe('edited');

  await deleteFromEditor(page, t('kind.credentials.singular'));
  expect(await admin.value(`consumers/${username}/credentials/${credential}`)).toBeUndefined();
  await gatewayAnswers(host, 401, { headers: { apikey: key } });
});

test('a consumer group: created in the form → in the list → a consumer joins it → edited → deleted', async ({ page, admin }) => {
  const id = `${PREFIX}grp-${uid()}`;
  const main = await openNew(page, 'consumer_groups/new');
  await idField(page).fill(id);
  await main.getByRole('textbox', { name: t('cg.general.name') }).fill(id);
  await create(page);
  expect(await admin.value(`consumer_groups/${id}`)).toEqual({ id, name: id, plugins: {} });
  await listShows(page, 'consumer_groups', id);

  // "New consumer in this group" from the Consumers tab.
  await openEditor(page, `consumer_groups/${id}?tab=members`);
  await page.getByRole('main').getByRole('link', { name: t('cg.members.new') }).first().click();
  const username = user(uid());
  await page.getByRole('main').getByRole('textbox', { name: new RegExp(`^${t('cs.general.username')}`) }).fill(username);
  await create(page);
  expect((await admin.value(`consumers/${username}`))?.group_id).toBe(id);
  await openEditor(page, `consumer_groups/${id}?tab=members`);
  await expect(page.getByRole('main').getByRole('tabpanel').getByRole('link', { name: username, exact: true })).toBeVisible();
  await admin.del(`consumers/${username}`);

  await openEditor(page, `consumer_groups/${id}`);
  await unlock(page);
  await page.getByRole('main').getByRole('textbox', { name: t('cg.general.desc') }).fill('edited');
  await save(page);
  expect((await admin.value(`consumer_groups/${id}`))?.desc).toBe('edited');

  await deleteFromEditor(page, t('kind.consumer_groups.singular'));
  expect(await admin.value(`consumer_groups/${id}`)).toBeUndefined();
  await listShows(page, 'consumer_groups', id, false);
});
