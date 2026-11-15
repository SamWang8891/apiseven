// The consumer editor as the registry wires it, on a fake Admin API: its tabs, the locked view,
// creating one (its username is its id), what Save sends from each tab (an auth plugin's key
// untouched), the key masked until revealed, and the Credentials tab left out on an APISIX without
// credentials.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Obj } from '../../api/types';
import { resetReadOnlyKeys } from '../../api/write';
import { t } from '../../i18n';
import { resetApp } from '../../test/app';
import { main, openEditor, writesOf } from '../../test/editor';
import { json, type FakeAdminOptions } from '../../test/fakeAdmin';
import { pluginReplies } from '../../test/plugins';
import { editableControls } from '../../test/schemaForm';
import { getToasts } from '../../ui/toast';

beforeAll(async () => {
  await import('./bodies');
  await import('../../plugins/PluginsTab');
  await import('../../schema-form/SchemaForm');
});

afterEach(() => {
  resetApp();
  resetReadOnlyKeys();
});

const tab = (label: string) => main().getByRole('tab', { name: new RegExp(`^${label}`) });
const TAB_LABELS = () => [t('cs.tab.general'), t('pl.tab'), t('cs.tab.credentials'), t('editor.json.tab')];

const KEY = 'jo-own-key-1';
/** As APISIX stores it, plus a key no form shows (APISIX's schema forbids one today; a newer one may not). */
const JO: Obj = {
  username: 'jo',
  desc: 'Jo',
  labels: { team: 'a' },
  group_id: 'partners',
  plugins: { 'key-auth': { key: KEY }, 'limit-count': { count: 5, time_window: 60, x_plugin: 'kept' } },
  x_future: { kept: true },
  create_time: 1700000000,
  update_time: 1700000100,
};
const GROUPS: Obj[] = [{ id: 'partners', name: 'Partners', plugins: { cors: {} } }, { id: 'staff', name: 'staff', plugins: {} }];
const CREDENTIALS = { jo: [{ id: 'c1', name: 'first', plugins: { 'key-auth': { key: 'c1-key' } } }] };

async function openConsumer(hash = '#/consumers/jo', opts: FakeAdminOptions = {}) {
  const app = await openEditor(hash, { objects: { consumers: [JO], consumer_groups: GROUPS }, credentials: CREDENTIALS, replies: pluginReplies(), ...opts });
  await main().findByRole('heading', { level: 1, name: 'jo' });
  return app;
}

/** Waits for the active tab's body (lazy, and its cards) to settle. */
async function settled() {
  const panel = await main().findByRole('tabpanel');
  await waitFor(() => expect(panel.querySelector('.ed-lazy__loading, [aria-busy="true"], .pl-note:not(.pl-note--warn)')).toBeNull());
  return panel;
}

/** The stored object as Save must send it back: without the timestamps, with `change` on top. */
const loadedWith = (stored: Obj, change: Obj): Obj => {
  const rest = { ...stored };
  delete rest.create_time;
  delete rest.update_time;
  return { ...rest, ...change };
};
const save = async (user: UserEvent) => user.click(main().getByRole('button', { name: t('editor.save') }));

describe('the consumer editor', () => {
  it('has General, Plugins, Credentials and JSON, and opens on General', async () => {
    await openConsumer();
    expect(main().getAllByRole('tab').map((el) => el.textContent)).toEqual(TAB_LABELS());
    expect(tab(t('cs.tab.general'))).toHaveAttribute('aria-selected', 'true');
  });

  it('opened locked, every tab reads as text: no form controls (the credentials table included)', async () => {
    const { user } = await openConsumer();
    for (const label of TAB_LABELS().slice(0, 3)) {
      await user.click(tab(label));
      const panel = await settled();
      if (label === t('cs.tab.credentials')) await within(panel).findByRole('link', { name: 'first' });
      expect(editableControls(panel), label).toEqual([]);
    }
  });

  it('the username is plain text even when unlocked: it is the id, and cannot change', async () => {
    const { user } = await openConsumer();
    await user.keyboard('e');
    await settled();
    expect(main().queryByRole('textbox', { name: /^Username/ })).not.toBeInTheDocument();
    expect(main().getByText(t('cs.general.usernameFixed'))).toBeInTheDocument();
  });

  it('the Credentials tab is left out on an APISIX without credentials (its /credentials answers 404)', async () => {
    await openConsumer('#/consumers/jo', { replies: { ...pluginReplies(), credentials: () => json(404, { error_msg: 'Unsupported resource type' }) } });
    await waitFor(() => expect(main().getAllByRole('tab').map((el) => el.textContent)).toEqual([t('cs.tab.general'), t('pl.tab'), t('editor.json.tab')]));
    expect(main().getByRole('region', { name: t('cs.overview') })).not.toHaveTextContent(t('cs.tab.credentials'));
  });
});

describe('creating a consumer', () => {
  it('has no ID field: the username is the id; Create PUTs consumers/<username> with the username in the body', async () => {
    const { user, admin } = await openEditor('#/consumers/new', { objects: { consumers: [], consumer_groups: GROUPS }, replies: pluginReplies() });
    await settled();
    expect(main().queryByRole('textbox', { name: /^ID/ })).not.toBeInTheDocument();
    await user.type(main().getByRole('textbox', { name: /^Username/ }), 'jo');
    await user.type(main().getByRole('textbox', { name: t('cs.general.desc') }), 'Jo');
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(writesOf(admin)).toEqual([{ method: 'PUT', path: 'consumers/jo', body: { username: 'jo', desc: 'Jo' } }]));
    await waitFor(() => expect(window.location.hash).toBe('#/consumers/jo'));
  });

  it('without a username, Create is refused: General is badged and the field asks for one', async () => {
    const { user, admin } = await openEditor('#/consumers/new', { objects: { consumers: [], consumer_groups: GROUPS }, replies: pluginReplies() });
    await settled();
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    expect(writesOf(admin)).toEqual([]);
    expect(tab(t('cs.tab.general'))).toHaveAccessibleName(`${t('cs.tab.general')} ${t('ui.tabs.errors', { count: 1 })}`);
    expect(main().getByRole('textbox', { name: /^Username/ })).toHaveAccessibleDescription(t('cs.issue.username'));
  });

  it('a username APISIX refuses blocks Create, named on the field', async () => {
    const { user, admin } = await openEditor('#/consumers/new', { objects: { consumers: [] }, replies: pluginReplies() });
    await settled();
    await user.type(main().getByRole('textbox', { name: /^Username/ }), 'jo e');
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    expect(writesOf(admin)).toEqual([]);
    expect(getToasts().at(-1)?.message).toBe(t('editor.fixOne'));
    expect(main().getByRole('textbox', { name: /^Username/ })).toHaveAccessibleDescription(t('cs.issue.usernamePattern'));
  });

  it('from a group\'s "New consumer in this group": starts in that group', async () => {
    const { user, admin } = await openEditor('#/consumers/new?group_id=staff', { objects: { consumers: [], consumer_groups: GROUPS }, replies: pluginReplies() });
    await settled();
    await user.type(main().getByRole('textbox', { name: /^Username/ }), 'sam');
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(writesOf(admin)).toEqual([{ method: 'PUT', path: 'consumers/sam', body: { username: 'sam', group_id: 'staff' } }]));
  });
});

describe("a save from each tab sends every field the tab does not own exactly as loaded (the key untouched)", () => {
  it('General: the description', async () => {
    const { user, admin } = await openConsumer();
    await user.keyboard('e');
    await settled();
    await user.type(main().getByRole('textbox', { name: t('cs.general.desc') }), ' E');
    await save(user);
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]).toEqual({ method: 'PUT', path: 'consumers/jo', body: loadedWith(JO, { desc: 'Jo E' }) });
  });

  it('General: the group, chosen again', async () => {
    const { user, admin } = await openConsumer();
    await user.keyboard('e');
    await settled();
    await user.click(main().getByRole('combobox', { name: t('cs.general.group') }));
    await user.click(await screen.findByRole('option', { name: /^staff/ }));
    await save(user);
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body).toEqual(loadedWith(JO, { group_id: 'staff' }));
  });

  it('Plugins: limit-count switched off', async () => {
    const { user, admin } = await openConsumer('#/consumers/jo?tab=plugins');
    await settled();
    await user.keyboard('e');
    await user.click(main().getByRole('switch', { name: 'Enable limit-count' }));
    await save(user);
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    const plugins = { ...(JO.plugins as Obj), 'limit-count': { count: 5, time_window: 60, x_plugin: 'kept', _meta: { disable: true } } };
    expect(writesOf(admin)[0]?.body).toEqual(loadedWith(JO, { plugins }));
  });

  it('after Save the draft is the stored value again, never the ciphertext APISIX echoed: a second save sends the key as loaded', async () => {
    const { user, admin } = await openConsumer();
    await user.keyboard('e');
    await settled();
    await user.type(main().getByRole('textbox', { name: t('cs.general.desc') }), '1');
    await save(user);
    await main().findByRole('button', { name: t('editor.edit') });
    await user.keyboard('e');
    await user.type(main().getByRole('textbox', { name: t('cs.general.desc') }), '2');
    await save(user);
    await waitFor(() => expect(writesOf(admin)).toHaveLength(2));
    expect(writesOf(admin)[1]?.body).toEqual(loadedWith(JO, { desc: 'Jo12' }));
    expect(JSON.stringify(writesOf(admin))).not.toContain('$ENC$');
  });
});

describe("the consumer's own key-auth key", () => {
  it('is masked locked and while editing until revealed; the reveal ends with Save', async () => {
    const { user, admin } = await openConsumer('#/consumers/jo?tab=plugins');
    await settled();
    const card = await main().findByRole('group', { name: 'key-auth' });
    await user.click(within(card).getByRole('button', { name: 'key-auth' }));
    expect(document.body.innerHTML).not.toContain(KEY);
    await user.click(within(card).getByRole('button', { name: t('ui.secret.show') }));
    expect(within(card).getByText(KEY)).toBeInTheDocument();

    await user.keyboard('e');
    const key = within(card).getByLabelText(/^key\b(?!-)/);
    expect(key).toHaveAttribute('type', 'password');
    await user.click(within(card).getByRole('button', { name: t('ui.secret.show') }));
    expect(key).toHaveAttribute('type', 'text');
    await user.click(main().getByRole('switch', { name: 'Enable limit-count' }));
    await save(user);
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(((writesOf(admin)[0]?.body?.plugins as Obj)['key-auth'] as Obj).key).toBe(KEY);
    await main().findByRole('button', { name: t('editor.edit') });
    expect(document.body.innerHTML).not.toContain(KEY);
    await user.keyboard('e');
    expect(within(main().getByRole('group', { name: 'key-auth' })).getByLabelText(/^key\b(?!-)/)).toHaveAttribute('type', 'password');
  });
});
