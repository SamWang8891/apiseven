// "What you see is what gets saved" (addendum rules 1–2, 9, 11, 13, 20): text a field shows is either
// saved as shown or holds the save back, and leaving it never loses or changes what is stored.
import {
  Admin,
  expect,
  jsonEditor,
  openCard,
  openEditor,
  openTab,
  recordWrites,
  save,
  setCode,
  storedRoute as stored_,
  t,
  tabNamed,
  test,
  toast,
  unlock,
  type Json,
} from './fixtures';

const PREFIX = 'e2e-wysiwyg-';
const ROUTE = t('kind.routes.singular');

test.afterAll(async () => {
  await new Admin().removePrefixed(PREFIX);
});

const storedRoute = (admin: Admin, extra: Json = {}) => stored_(admin, PREFIX, extra);

/** Switches tab while the current one holds input: the question, and the choice made. */
async function switchTabAnswering(page: import('@playwright/test').Page, label: string, answer: 'stay' | 'discard') {
  await page.getByRole('main').getByRole('tab', { name: new RegExp(`^${label}( |$)`) }).click();
  const ask = page.getByRole('alertdialog', { name: t('editor.pending.title') });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: t(answer === 'stay' ? 'editor.pending.stay' : 'editor.pending.discard') }).click();
  await expect(ask).toBeHidden();
}

test('a host typed into Hosts without Enter is saved by Cmd/Ctrl-S', async ({ page, admin }) => {
  const { id, host } = await storedRoute(admin);
  await openEditor(page, `routes/${id}?tab=matching`);
  await unlock(page);
  await page.getByRole('main').getByRole('textbox', { name: t('rt.match.hosts') }).fill(`typed.${host}`);
  const writes = recordWrites(page);
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.getByRole('main').getByRole('button', { name: t('editor.edit'), exact: true })).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0]!.body?.hosts).toEqual([host, `typed.${host}`]);
  expect((await admin.value(`routes/${id}`))?.hosts).toEqual([host, `typed.${host}`]);
});

test('a host the check refuses holds the save: the toast names Hosts, nothing is sent, the text stays', async ({ page, admin }) => {
  const { id, stored } = await storedRoute(admin);
  await openEditor(page, `routes/${id}?tab=matching`);
  await unlock(page);
  const hosts = page.getByRole('main').getByRole('textbox', { name: t('rt.match.hosts') });
  await hosts.fill('not a host!');
  const writes = recordWrites(page);
  await page.keyboard.press('ControlOrMeta+s');
  const refusal = toast(page, new RegExp(t('rt.match.hosts')));
  await expect(refusal).toBeVisible();
  await page.getByRole('main').getByRole('button', { name: t('editor.save'), exact: true }).click();
  // The second refusal is the same toast, now counted twice: only then is the request log read.
  await expect(refusal).toContainText(t('ui.toast.repeat', { count: 2 }));
  await expect(hosts).toHaveValue('not a host!');
  await expect(hosts).toHaveAttribute('aria-invalid', 'true');
  expect(writes).toEqual([]);
  expect(await admin.value(`routes/${id}`)).toEqual(stored);
});

test('broken JSON in a plugin card refuses Save naming the plugin, keeps the card open; fixed, it saves', async ({ page, admin }) => {
  const { id } = await storedRoute(admin, { plugins: { 'limit-count': { count: 5, time_window: 60 } } });
  await openEditor(page, `routes/${id}?tab=plugins`);
  await unlock(page);
  const card = await openCard(page, 'limit-count');
  await card.getByRole('group', { name: t('pl.card.view', { name: 'limit-count' }) }).getByRole('button', { name: t('pl.card.json') }).click();
  const json = card.getByRole('textbox', { name: t('pl.card.jsonLabel', { name: 'limit-count' }) });
  await setCode(page, json, '{"count": 6, "time_window": ');
  const writes = recordWrites(page);
  await page.getByRole('main').getByRole('button', { name: t('editor.save'), exact: true }).click();
  await expect(toast(page, /limit-count/)).toBeVisible();
  expect(writes).toEqual([]);
  // The card refuses to collapse while it holds the text.
  const head = card.getByRole('button', { name: /^limit-count\b/ }).first();
  await head.click();
  await expect(head).toHaveAttribute('aria-expanded', 'true');
  await expect(json).toBeVisible();
  await setCode(page, json, '{"count": 6, "time_window": 60}');
  await save(page);
  expect((await admin.value(`routes/${id}`))?.plugins).toEqual({ 'limit-count': { count: 6, time_window: 60 } });
});

test('broken JSON-tab text asks before another tab: Stay keeps it; Discard and switch drops it and a later Save stores only the new change', async ({ page, admin }) => {
  const { id, stored } = await storedRoute(admin);
  await openEditor(page, `routes/${id}?tab=json`);
  await unlock(page);
  const json = jsonEditor(page, ROUTE);
  await setCode(page, json, '{"name": "broken", ');
  await switchTabAnswering(page, t('rt.tab.general'), 'stay');
  // The tab's name goes on with its problem badge while the text is broken.
  await expect(tabNamed(page, t('editor.json.tab'))).toHaveAttribute('aria-selected', 'true');
  await expect(json).toContainText('"name": "broken",');
  await switchTabAnswering(page, t('rt.tab.general'), 'discard');
  await page.getByRole('main').getByRole('textbox', { name: t('rt.general.desc') }).fill('the only change');
  await save(page);
  expect(await admin.value(`routes/${id}`)).toEqual({ ...stored, desc: 'the only change' });
});

test('a stored condition whose value is broken, then discarded on a tab switch, is still stored, in order, after another save', async ({ page, admin }) => {
  const vars = [
    ['arg_n', '>', 5],
    ['arg_b', '==', '2'],
  ];
  const { id, stored } = await storedRoute(admin, { vars });
  await openEditor(page, `routes/${id}?tab=matching`);
  await unlock(page);
  await page.getByRole('main').getByRole('textbox', { name: t('rt.vars.valueN', { n: 1 }) }).fill('not a number');
  await switchTabAnswering(page, t('rt.tab.general'), 'discard');
  await page.getByRole('main').getByRole('textbox', { name: t('rt.general.desc') }).fill('changed elsewhere');
  const write = await save(page);
  expect(write.body?.vars).toEqual(vars);
  expect(await admin.value(`routes/${id}`)).toEqual({ ...stored, desc: 'changed elsewhere' });
});

test('a label whose key is cleared, then discarded on a tab switch, is still stored; a real rename is stored as a rename', async ({ page, admin }) => {
  const { id, stored } = await storedRoute(admin, { labels: { team: 'e2e', env: 'test' } });
  const main = await openEditor(page, `routes/${id}`);
  await unlock(page);
  const labels = main.getByRole('group', { name: t('rt.general.labels') });
  const keyOf = async (value: string) => {
    for (let n = 1; n <= 2; n++) {
      const key = labels.getByRole('textbox', { name: t('ui.kv.keyN', { n }), exact: true });
      if ((await key.inputValue()) === value) return key;
    }
    throw new Error(`no label ${value}`);
  };
  await (await keyOf('team')).fill('');
  await switchTabAnswering(page, t('rt.tab.matching'), 'discard');
  await openTab(page, t('rt.tab.general'));
  await main.getByRole('textbox', { name: t('rt.general.desc') }).fill('another change');
  await save(page);
  expect(await admin.value(`routes/${id}`)).toEqual({ ...stored, desc: 'another change' });

  await unlock(page);
  await (await keyOf('team')).fill('squad');
  await save(page);
  expect((await admin.value(`routes/${id}`))?.labels).toEqual({ squad: 'e2e', env: 'test' });
});

test('a condition list of numbers survives an unrelated form edit with its numbers intact', async ({ page, admin }) => {
  const vars = [['post_arg.id', 'in', [1, 2]]];
  const { id, stored } = await storedRoute(admin, { vars });
  const main = await openEditor(page, `routes/${id}`);
  await unlock(page);
  await main.getByRole('textbox', { name: t('rt.general.desc') }).fill('unrelated');
  const write = await save(page);
  expect(write.body?.vars).toEqual(vars);
  expect(await admin.value(`routes/${id}`)).toEqual({ ...stored, desc: 'unrelated' });
});
