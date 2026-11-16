import {
  Admin,
  ECHO,
  create,
  deleteFromEditor,
  echoRoute,
  escapeRegExp,
  expect,
  gatewayAnswers,
  idField,
  listShows,
  openEditor,
  openNew,
  openTab,
  recordWrites,
  save,
  sentWrites,
  t,
  test,
  toast,
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

// Task 16b and the final wave: the node table writes nothing when a field is left. In an upstream whose
// nodes are a map (address → weight), host:port typed into "Add a node" is held in a new row as typed,
// flagged (a host there holds ":" only as an IPv6 address), until Enter or "Move … to Port" splits it.
test('host:port typed into "Add a node" of a map: held and flagged; leaving it adds nothing and a Save sends nothing; Enter splits it, and Save stores the node', async ({ page, admin }) => {
  const id = `${PREFIX}${uid()}`;
  await admin.put(`upstreams/${id}`, { name: id, type: 'roundrobin', nodes: { [`${ECHO.host}:${ECHO.port}`]: 1 } });
  const stored = await admin.must(`upstreams/${id}`);
  await openEditor(page, `upstreams/${id}`);
  await unlock(page);
  const nodes = await openTab(page, t('up.section.nodes'));
  await nodes.getByRole('textbox', { name: t('up.nodes.new') }).pressSequentially('other.e2e.test:8080');
  const host = nodes.getByRole('textbox', { name: t('up.nodes.hostN', { n: 2 }) });
  const port = nodes.getByRole('spinbutton', { name: t('up.nodes.portN', { n: 2 }) });
  await expect(host).toHaveValue('other.e2e.test:8080');
  await expect(host).toHaveAttribute('aria-invalid', 'true');
  await expect(host).toHaveAccessibleDescription(new RegExp(escapeRegExp(t('up.nodes.colonHeld'))));
  await expect(nodes.getByRole('button', { name: t('up.nodes.movePortN', { port: '8080', n: 2 }) })).toBeVisible();
  // Leaving it writes nothing: it stays held, and a Save is refused without a request, naming it.
  await host.press('Tab');
  await expect(host).toHaveValue('other.e2e.test:8080');
  await expect(host).toHaveAttribute('aria-invalid', 'true');
  const writes = recordWrites(page);
  await page.keyboard.press('ControlOrMeta+s');
  await expect(toast(page, t('editor.fixOne')).filter({ hasText: 'other.e2e.test:8080' })).toBeVisible();
  expect(sentWrites(writes)).toEqual([]);
  expect(await admin.value(`upstreams/${id}`)).toEqual(stored);
  // Enter in it splits it into a host and a port.
  await host.focus();
  await host.press('Enter');
  await expect(host).toHaveValue('other.e2e.test');
  await expect(port).toHaveValue('8080');
  await expect(host).not.toHaveAttribute('aria-invalid', 'true');
  const write = await save(page);
  expect(write.method).toBe('PUT');
  expect(await admin.value(`upstreams/${id}`)).toEqual({ ...stored, nodes: { [`${ECHO.host}:${ECHO.port}`]: 1, 'other.e2e.test:8080': 1 } });
  await admin.del(`upstreams/${id}`);
});
