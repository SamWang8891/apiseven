import {
  Admin,
  ECHO,
  create,
  deleteFromEditor,
  echoRoute,
  expect,
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

const PREFIX = 'e2e-up-';

test.afterAll(async () => {
  await new Admin().removePrefixed(PREFIX);
});

test('an upstream: created in the form → in the list → a route through it answers → one field edited → deleted', async ({ page, admin }) => {
  const id = `${PREFIX}${uid()}`;
  const main = await openNew(page, 'upstreams/~new');
  await idField(page).fill(id);
  await main.getByRole('textbox', { name: t('up.general.name') }).fill(id);
  const nodes = await openTab(page, t('up.section.nodes'));
  await nodes.getByRole('textbox', { name: t('up.nodes.new') }).fill(ECHO.host);
  await nodes.getByRole('spinbutton', { name: t('up.nodes.portN', { n: 1 }) }).fill(String(ECHO.port));
  const write = await create(page);
  expect(write.path).toBe(`upstreams/${id}`);
  expect(await admin.value(`upstreams/${id}`)).toEqual({ id, name: id, type: 'roundrobin', nodes: [{ host: ECHO.host, port: ECHO.port, weight: 1 }] });

  await listShows(page, 'upstreams', id);

  // A route that names it reaches the echo target.
  const host = `${id}.e2e.test`;
  await admin.put(`routes/${id}`, { ...echoRoute(id, host), upstream: undefined, upstream_id: id });
  const reply = await gatewayAnswers(host, 200);
  expect(reply.text).toMatch(ECHO.body);
  await admin.del(`routes/${id}`);

  await openEditor(page, `upstreams/${id}`);
  await unlock(page);
  await page.getByRole('main').getByRole('textbox', { name: t('up.general.desc') }).fill('edited');
  await save(page);
  expect((await admin.value(`upstreams/${id}`))?.desc).toBe('edited');

  await deleteFromEditor(page, t('kind.upstreams.singular'));
  expect(await admin.value(`upstreams/${id}`)).toBeUndefined();
  await listShows(page, 'upstreams', id, false);
});
