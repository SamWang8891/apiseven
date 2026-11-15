// The credential editor (#/consumers/<username>/credentials/<id>) on a fake Admin API: where it saves,
// its link back to the consumer, its one auth plugin, and its key, which is masked until revealed
// and sent back exactly as loaded when untouched.
import { screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Obj } from '../../api/types';
import { resetReadOnlyKeys } from '../../api/write';
import { t } from '../../i18n';
import { resetApp } from '../../test/app';
import { jsonEditor, main, openEditor, writesOf } from '../../test/editor';
import type { FakeAdminOptions } from '../../test/fakeAdmin';
import { pluginReplies } from '../../test/plugins';
import { editableControls } from '../../test/schemaForm';

beforeAll(async () => {
  await import('./bodies');
  await import('../consumers/bodies');
  await import('../../plugins/PluginsTab');
  await import('../../schema-form/SchemaForm');
});

afterEach(() => {
  resetApp();
  resetReadOnlyKeys();
});

const tab = (label: string) => main().getByRole('tab', { name: new RegExp(`^${label}`) });
const KEY = 'c1-secret-key';
/** As APISIX stores it, plus a key no form shows (APISIX's schema forbids one today; a newer one may not). */
const C1: Obj = { id: 'c 1', name: 'first', desc: 'CI', labels: { env: 'ci' }, plugins: { 'key-auth': { key: KEY } }, x_future: { kept: true }, create_time: 1700000000, update_time: 1700000100 };
const CONSUMERS: Obj[] = [{ username: 'jo e' }, { username: 'jo', desc: 'Jo' }];

async function openCredential(hash = '#/consumers/jo%20e/credentials/c%201', opts: FakeAdminOptions = {}) {
  const app = await openEditor(hash, { objects: { consumers: CONSUMERS }, credentials: { 'jo e': [C1] }, replies: pluginReplies(), ...opts });
  await main().findByRole('heading', { level: 1, name: 'first' });
  return app;
}

async function settled() {
  const panel = await main().findByRole('tabpanel');
  await waitFor(() => expect(panel.querySelector('.ed-lazy__loading, [aria-busy="true"]')).toBeNull());
  return panel;
}

const loadedWith = (stored: Obj, change: Obj): Obj => {
  const rest = { ...stored };
  delete rest.create_time;
  delete rest.update_time;
  return { ...rest, ...change };
};
const save = async (user: UserEvent) => user.click(main().getByRole('button', { name: t('editor.save') }));

describe('the credential editor', () => {
  it('has General, Plugins and JSON; the header names its consumer and links back to its Credentials tab', async () => {
    await openCredential();
    expect(main().getAllByRole('tab').map((el) => el.textContent)).toEqual([t('cr.tab.general'), t('pl.tab'), t('editor.json.tab')]);
    expect(main().getByRole('link', { name: 'jo e' })).toHaveAttribute('href', '#/consumers/jo%20e?tab=credentials');
    expect(main().getByRole('link', { name: t('editor.backTo', { kind: t('kind.consumers.singular'), name: 'jo e' }) })).toHaveAttribute('href', '#/consumers/jo%20e?tab=credentials');
    expect(screen.getByRole('navigation', { name: t('shell.breadcrumb') })).toContainElement(screen.getByRole('link', { name: t('kind.credentials.plural') }));
    expect(screen.getByRole('link', { name: t('kind.credentials.plural') })).toHaveAttribute('href', '#/consumers/jo%20e?tab=credentials');
  });

  it('opened locked, General and Plugins read as text: no form controls, and the key is nowhere', async () => {
    const { user } = await openCredential();
    for (const label of [t('cr.tab.general'), t('pl.tab')]) {
      await user.click(tab(label));
      const panel = await settled();
      expect(editableControls(panel), label).toEqual([]);
    }
    expect(document.body.innerHTML).not.toContain(KEY);
  });

  it('for consumer "jo e" and id "c 1", Save PUTs consumers/jo%20e/credentials/c%201 with every other field as loaded', async () => {
    const { user, admin } = await openCredential();
    await user.keyboard('e');
    await settled();
    const desc = main().getByRole('textbox', { name: t('cr.general.desc') });
    await user.clear(desc);
    await user.type(desc, 'deploys');
    await save(user);
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]).toEqual({ method: 'PUT', path: 'consumers/jo%20e/credentials/c%201', body: loadedWith(C1, { desc: 'deploys' }) });
    expect(JSON.stringify(writesOf(admin))).not.toContain('$ENC$');
  });
});

describe('the key of a key-auth credential', () => {
  const openCard = async (user: UserEvent) => {
    const card = await main().findByRole('group', { name: 'key-auth' });
    if (within(card).getByRole('button', { name: 'key-auth' }).getAttribute('aria-expanded') !== 'true') await user.click(within(card).getByRole('button', { name: 'key-auth' }));
    return card;
  };

  it('is masked locked and while editing until revealed; untouched, Save sends the stored key', async () => {
    const { user, admin } = await openCredential('#/consumers/jo%20e/credentials/c%201?tab=plugins');
    await settled();
    let card = await openCard(user);
    expect(document.body.innerHTML).not.toContain(KEY);
    await user.click(within(card).getByRole('button', { name: t('ui.secret.show') }));
    expect(within(card).getByText(KEY)).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: t('ui.secret.hide') }));
    expect(document.body.innerHTML).not.toContain(KEY);

    await user.keyboard('e');
    card = await openCard(user);
    const key = within(card).getByLabelText(/^key\b(?!-)/);
    expect(key).toHaveAttribute('type', 'password');
    await user.click(within(card).getByRole('button', { name: t('ui.secret.show') }));
    expect(key).toHaveAttribute('type', 'text');
    expect(key).toHaveValue(KEY);

    await user.click(tab(t('cr.tab.general')));
    await settled();
    await user.type(main().getByRole('textbox', { name: t('cr.general.name') }), '!');
    await save(user);
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body).toEqual(loadedWith(C1, { name: 'first!' }));
  });

  it('a key revealed and changed: Save sends the new key; locked again, nothing of it shows, and the next Edit masks it', async () => {
    const { user, admin } = await openCredential('#/consumers/jo%20e/credentials/c%201?tab=plugins');
    await settled();
    await user.keyboard('e');
    const card = await openCard(user);
    const key = within(card).getByLabelText(/^key\b(?!-)/);
    await user.click(within(card).getByRole('button', { name: t('ui.secret.show') }));
    await user.clear(key);
    await user.type(key, 'rotated-key-2');
    await save(user);
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body).toEqual(loadedWith(C1, { plugins: { 'key-auth': { key: 'rotated-key-2' } } }));
    await main().findByRole('button', { name: t('editor.edit') });
    expect(document.body.innerHTML).not.toContain('rotated-key-2');
    await user.keyboard('e');
    expect(within(main().getByRole('group', { name: 'key-auth' })).getByLabelText(/^key\b(?!-)/)).toHaveAttribute('type', 'password');
  });
});

describe('a save from the Plugins tab sends every other field as loaded', () => {
  it('key-auth switched off: name, description, labels and the unknown key as loaded, the key untouched', async () => {
    const { user, admin } = await openCredential('#/consumers/jo%20e/credentials/c%201?tab=plugins');
    await settled();
    await user.keyboard('e');
    await user.click(main().getByRole('switch', { name: 'Enable key-auth' }));
    await save(user);
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body).toEqual(loadedWith(C1, { plugins: { 'key-auth': { key: KEY, _meta: { disable: true } } } }));
  });
});

describe('one auth plugin', () => {
  it('with one set, Add is replaced by a note; the picker offered only auth plugins before', async () => {
    const { user } = await openCredential('#/consumers/jo%20e/credentials/c%201?tab=plugins');
    await settled();
    await user.keyboard('e');
    expect(main().queryByRole('button', { name: t('pl.add') })).not.toBeInTheDocument();
    expect(main().getByText(t('pl.credentialOne'))).toBeInTheDocument();
  });

  it('with none, a note says nobody can sign in with it (APISIX stores it, so Save is not refused)', async () => {
    const { user, admin } = await openEditor('#/consumers/jo/credentials/new?tab=plugins', { objects: { consumers: CONSUMERS }, credentials: {}, replies: pluginReplies() });
    await settled();
    expect(main().getByText(t('pl.credentialNone'))).toBeInTheDocument();
    await user.type(main().getByRole('textbox', { name: /^ID/ }), 'c2');
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(writesOf(admin)).toEqual([{ method: 'PUT', path: 'consumers/jo/credentials/c2', body: {} }]));
  });

  it('two (pasted in JSON): Save is refused and the Plugins tab is badged', async () => {
    const { user, admin } = await openCredential('#/consumers/jo%20e/credentials/c%201?tab=json');
    await user.keyboard('e');
    const box = await jsonEditor(t('kind.credentials.singular'));
    await user.click(box);
    await user.keyboard('{Control>}a{/Control}');
    await user.paste(JSON.stringify({ ...loadedWith(C1, {}), plugins: { 'key-auth': { key: KEY }, 'basic-auth': { username: 'u', password: 'p' } } }));
    await save(user);
    expect(writesOf(admin)).toEqual([]);
    await waitFor(() => expect(tab(t('pl.tab'))).toHaveAccessibleName(`${t('pl.tab')} ${t('ui.tabs.errors', { count: 1 })}`));
  });
});

describe('creating a credential', () => {
  it('asks for an ID; key-auth from the picker, its key typed: Create PUTs under the consumer, then opens it', async () => {
    const { user, admin } = await openEditor('#/consumers/jo/credentials/new', { objects: { consumers: CONSUMERS }, credentials: {}, replies: pluginReplies() });
    await settled();
    await user.type(main().getByRole('textbox', { name: /^ID/ }), 'ci-key');
    await user.type(main().getByRole('textbox', { name: t('cr.general.name') }), 'CI');
    await user.click(tab(t('pl.tab')));
    await settled();
    await user.click(main().getByRole('button', { name: t('pl.add') }));
    const picker = await screen.findByRole('dialog', { name: t('pl.picker.title') });
    const offered = within(picker).getAllByRole('option').map((o) => o.getAttribute('data-plugin'));
    expect(offered).toContain('key-auth');
    expect(offered).not.toContain('limit-count');
    await user.click(within(picker).getByRole('option', { name: /^key-auth\b/ }));
    const card = await main().findByRole('group', { name: 'key-auth' });
    await user.type(within(card).getByLabelText(/^key\b(?!-)/), 'ci-secret');
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(writesOf(admin)).toEqual([{ method: 'PUT', path: 'consumers/jo/credentials/ci-key', body: { name: 'CI', plugins: { 'key-auth': { key: 'ci-secret' } } } }]));
    await waitFor(() => expect(window.location.hash).toBe('#/consumers/jo/credentials/ci-key'));
  });
});

describe("the consumer's Credentials tab follows the credential's saves", () => {
  it('Edit from the tab, rename, Save, back to the consumer: the list shows the new name (its query was invalidated)', async () => {
    const { user } = await openEditor('#/consumers/jo%20e?tab=credentials', { objects: { consumers: CONSUMERS }, credentials: { 'jo e': [C1] }, replies: pluginReplies() });
    const region = await main().findByRole('region', { name: t('kind.credentials.plural') });
    await user.click(await within(region).findByRole('button', { name: t('table.actionsFor', { name: 'first' }) }));
    await user.click(await screen.findByRole('menuitem', { name: t('action.edit') }));
    await main().findByRole('heading', { level: 1, name: 'first' });
    await user.keyboard('e');
    await settled();
    await user.type(main().getByRole('textbox', { name: t('cr.general.name') }), '-renamed');
    await save(user);
    await main().findByRole('heading', { level: 1, name: 'first-renamed' });
    await main().findByRole('button', { name: t('editor.edit') });
    await user.click(main().getByRole('link', { name: 'jo e' }));
    const back = await main().findByRole('region', { name: t('kind.credentials.plural') });
    expect(await within(back).findByRole('link', { name: 'first-renamed' })).toBeInTheDocument();
  });
});
