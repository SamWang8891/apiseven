// Secrets in the views that show a whole object as JSON: the editor's JSON tab while locked, and
// View JSON (the editor's ⋯ menu, a list row's menu). An auth plugin's key comes back from the Admin
// API in clear text, so these views mask it until the user asks to see it.
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { resetReadOnlyKeys } from '../api/write';
import { t } from '../i18n';
import { MASK } from '../schema/secrets';
import { resetApp } from '../test/app';
import { jsonEditor, main, openEditor, writesOf } from '../test/editor';
import { pluginReplies } from '../test/plugins';

afterEach(() => {
  resetApp();
  resetReadOnlyKeys();
});

const KEY = 'jo-secret-key-1';
const JO = { username: 'jo', desc: 'Jo', plugins: { 'key-auth': { key: KEY }, 'limit-count': { count: 5, time_window: 60 } } };
const objects = { consumers: [JO] };

async function openJson() {
  const app = await openEditor('#/consumers/jo?tab=json', { objects, replies: pluginReplies() });
  await main().findByRole('heading', { level: 1, name: 'jo' });
  const box = await jsonEditor(t('kind.consumers.singular'));
  await waitFor(() => expect(box.textContent).toContain(MASK));
  return { ...app, box };
}

describe('the JSON tab, locked', () => {
  it('masks the key: it is nowhere on the page until "Show secrets"', async () => {
    const { user, box } = await openJson();
    expect(box.textContent).toContain('"limit-count"');
    expect(document.body.innerHTML).not.toContain(KEY);
    await user.click(main().getByRole('button', { name: t('pl.card.secrets.show') }));
    expect(box.textContent).toContain(KEY);
    await user.click(main().getByRole('button', { name: t('pl.card.secrets.hide') }));
    expect(box.textContent).not.toContain(KEY);
  });

  it('Copy copies what is shown: the masked text', async () => {
    const { user } = await openJson();
    await user.click(main().getByRole('button', { name: t('json.copy') }));
    const copied = await navigator.clipboard.readText();
    expect(copied).toContain(MASK);
    expect(copied).not.toContain(KEY);
  });

  it('editing shows the real text; a save that leaves the key alone sends it unchanged, and the locked view masks it again', async () => {
    const { user, admin, box } = await openJson();
    await user.click(main().getByRole('button', { name: t('pl.card.secrets.show') }));
    await user.keyboard('e');
    await waitFor(() => expect(box.textContent).toContain(KEY));
    await user.click(box);
    await user.keyboard('{Control>}a{/Control}');
    await user.paste(JSON.stringify({ ...JO, desc: 'Jo E' }));
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body).toEqual({ ...JO, desc: 'Jo E' });
    await main().findByRole('button', { name: t('editor.edit') });
    await waitFor(() => expect(box.textContent).toContain(MASK));
    expect(document.body.innerHTML).not.toContain(KEY);
    expect(main().getByRole('button', { name: t('pl.card.secrets.show') })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('View JSON', () => {
  it("in the editor's menu: masked, with a toggle", async () => {
    const { user } = await openEditor('#/consumers/jo', { objects, replies: pluginReplies() });
    await main().findByRole('heading', { level: 1, name: 'jo' });
    await user.click(main().getByRole('button', { name: t('editor.more') }));
    await user.click(await screen.findByRole('menuitem', { name: t('action.viewJson') }));
    const dialog = await screen.findByRole('dialog', { name: t('json.title', { kind: t('kind.consumers.singular'), name: 'jo' }) });
    const box = await within(dialog).findByRole('textbox');
    await waitFor(() => expect(box.textContent).toContain(MASK));
    expect(document.body.innerHTML).not.toContain(KEY);
    await user.click(within(dialog).getByRole('button', { name: t('pl.card.secrets.show') }));
    expect(box.textContent).toContain(KEY);
  });

  it("in a list row's menu: masked, and Copy copies the masked text", async () => {
    const { user } = await openEditor('#/consumers', { objects, replies: pluginReplies() });
    await user.click(await main().findByRole('button', { name: t('table.actionsFor', { name: 'jo' }) }));
    await user.click(await screen.findByRole('menuitem', { name: t('action.viewJson') }));
    const dialog = await screen.findByRole('dialog');
    const box = await within(dialog).findByRole('textbox');
    await waitFor(() => expect(box.textContent).toContain(MASK));
    expect(document.body.innerHTML).not.toContain(KEY);
    await user.click(within(dialog).getByRole('button', { name: t('json.copy') }));
    expect(await navigator.clipboard.readText()).not.toContain(KEY);
  });
});
