// Local checks are never a dead end (Task 16): a draft that only the checks in this browser refuse
// can be sent with Save anyway, and APISIX's answer decides; never while a field holds input.
import { Admin, echoRoute, expect, openEditor, openTab, recordWrites, t, test, toast, uid, unlock } from './fixtures';

const PREFIX = 'e2e-anyway-';

test.afterAll(async () => {
  await new Admin().removePrefixed(PREFIX);
});

test('a route APISIX accepts but the local check refuses: Save refused, then Save anyway stores it; not while a field holds input', async ({ page, admin }) => {
  // PCRE's $ matches before a final newline and JavaScript's does not: APISIX takes this host, the
  // browser's check of proxy-rewrite's schema refuses it.
  const id = `${PREFIX}${uid()}`;
  const host = `${id}.e2e.test`;
  await admin.put(`routes/${id}`, echoRoute(id, host, { plugins: { 'proxy-rewrite': { host: 'upstream.test\n' } } }));
  const stored = await admin.must(`routes/${id}`);
  const main = await openEditor(page, `routes/${id}`);
  await unlock(page);
  await main.getByRole('textbox', { name: t('rt.general.desc') }).fill('sent with Save anyway');
  const writes = recordWrites(page);
  await main.getByRole('button', { name: t('editor.save'), exact: true }).click();
  await expect(toast(page, t('editor.fixAnyway', { fix: t('editor.fixOne') }))).toBeVisible();
  expect(writes).toEqual([]);
  const anyway = main.getByRole('button', { name: t('editor.anyway.action'), exact: true });
  await expect(anyway).toBeVisible();
  await expect(main.getByText(t('editor.anyway.title'))).toBeVisible();

  // A field that holds input takes the offer away until it is cleared.
  const hosts = (await openTab(page, t('rt.tab.matching'))).getByRole('textbox', { name: t('rt.match.hosts') });
  await hosts.fill('not a host!');
  await hosts.press('Enter');
  await expect(hosts).toHaveAttribute('aria-invalid', 'true');
  await expect(anyway).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+s');
  await expect(toast(page, new RegExp(t('rt.match.hosts')))).toBeVisible();
  expect(writes).toEqual([]);
  await hosts.fill('');
  await main.getByRole('button', { name: t('editor.save'), exact: true }).click();
  await expect(anyway).toBeVisible();

  await anyway.click();
  const confirm = page.getByRole('alertdialog', { name: t('editor.anyway.confirmTitle') });
  await expect(confirm).toContainText('proxy-rewrite');
  await confirm.getByRole('button', { name: t('editor.anyway.confirm') }).click();
  await expect(main.getByRole('button', { name: t('editor.edit'), exact: true })).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(await admin.value(`routes/${id}`)).toEqual({ ...stored, desc: 'sent with Save anyway' });
});
