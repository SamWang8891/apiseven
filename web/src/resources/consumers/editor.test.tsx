// The consumer editor as the registry wires it, on a fake Admin API: its tabs, the locked view,
// creating one (its username is its id), what Save sends from each tab (an auth plugin's key
// untouched), the key masked until revealed, and the Credentials tab left out on an APISIX without
// credentials.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { focusManager } from '@tanstack/react-query';
import type { UserEvent } from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Obj } from '../../api/types';
import { resetReadOnlyKeys } from '../../api/write';
import { t } from '../../i18n';
import { resetApp } from '../../test/app';
import { jsonEditor, main, openEditor, writesOf } from '../../test/editor';
import { json, type FakeAdminOptions } from '../../test/fakeAdmin';
import { pluginFixture } from '../../test/pluginFixture';
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
/** The copy's notice above the tabs (CopyNotice). */
const notice = () => main().getByRole('note', { name: t('editor.copyNotice.title') });

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
    // The username is the id in the path: the frame's refusal, named in the toast, with no Save anyway.
    expect(getToasts().at(-1)?.message).toBe(t('editor.fixHeld', { fix: t('editor.fixOne'), message: t('cs.id.refused', { problem: t('cs.issue.usernamePattern') }) }));
    expect(main().getByRole('textbox', { name: /^Username/ })).toHaveAccessibleDescription(t('cs.issue.usernamePattern'));
    expect(main().queryByRole('button', { name: t('editor.anyway.action') })).toBeNull();
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

describe("a consumer's own auth plugins sign in whatever \"off\" says; its other plugins switch off", () => {
  it.each(['key-auth', 'basic-auth', 'jwt-auth', 'hmac-auth', 'jwe-decrypt', 'ldap-auth', 'ldap-auth-advanced', 'multi-auth', 'wolf-rbac'])(
    '%s: no on/off switch (header and run options), locked or editing',
    async (plugin) => {
      const { user } = await openEditor('#/consumers/sam?tab=plugins', { objects: { consumers: [{ username: 'sam', plugins: { [plugin]: {}, 'limit-count': { count: 1, time_window: 1 } } }] }, replies: pluginReplies() });
      await main().findByRole('heading', { level: 1, name: 'sam' });
      await settled();
      const card = await main().findByRole('group', { name: plugin });
      for (const step of ['locked', 'editing']) {
        if (step === 'editing') await user.keyboard('e');
        expect(within(card).queryByRole('switch'), step).toBeNull();
        // limit-count, which "off" does switch off here, keeps its switch (a switch is text while locked).
        if (step === 'editing') expect(main().getByRole('switch', { name: 'Enable limit-count' })).toBeInTheDocument();
      }
      await user.click(within(card).getByRole('button', { name: plugin }));
      await user.click(within(card).getByRole('button', { name: new RegExp(`^${t('pl.meta.title')}`) }));
      expect(within(card).queryByRole('switch')).toBeNull();
    },
  );
});

describe('Duplicate', () => {
  it("a copy of a consumer takes everything but its key; Create is refused until a new key is typed, then sends that", async () => {
    const { user, admin } = await openEditor('#/consumers/new?from=jo&tab=plugins', { objects: { consumers: [JO], consumer_groups: GROUPS }, credentials: CREDENTIALS, replies: pluginReplies() });
    await main().findByRole('button', { name: t('editor.create') });
    await settled();
    expect(document.body.innerHTML).not.toContain(KEY);
    expect(notice()).toHaveTextContent(t('editor.copyNotice.secrets', { list: [t('editor.copyNotice.secretItem', { plugin: 'key-auth', fields: 'key' })].join(', ') }));
    await user.click(main().getByRole('tab', { name: new RegExp(`^${t('cs.tab.general')}`) }));
    await settled();
    await user.type(main().getByRole('textbox', { name: /^Username/ }), 'jo2');
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    expect(writesOf(admin)).toEqual([]);
    await waitFor(() => expect(main().getByRole('tab', { name: /^Plugins/ })).toHaveAccessibleName(`${t('pl.tab')} ${t('ui.tabs.errors', { count: 1 })}`));

    await user.click(main().getByRole('tab', { name: /^Plugins/ }));
    await settled();
    const card = await main().findByRole('group', { name: 'key-auth' });
    await user.type(within(card).getByLabelText(/^key\b(?!-)/), 'jo2-key');
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    const body = writesOf(admin)[0]?.body as Obj;
    expect(body).toMatchObject({ username: 'jo2', desc: 'Jo', group_id: 'partners', plugins: { 'key-auth': { key: 'jo2-key' }, 'limit-count': { count: 5, time_window: 60, x_plugin: 'kept' } } });
  });
});

describe('Duplicate on a cold cache (the plugin list not loaded yet when the copy opens)', () => {
  const SOURCE: Obj = { username: 'src', plugins: { 'my-auth': { key: 'SEKRET-1' }, 'key-auth': { key: 'K-9' }, 'limit-count': { count: 1, time_window: 1 } } };
  const myAuth = { schema: { type: 'object' }, type: 'auth', consumer_schema: { type: 'object' } };

  it('waits for the list: a custom auth plugin whose secret fields are unknown is left out whole; no secret is in the draft or the page', async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    const replies = {
      plugins: async () => {
        await held;
        return json(200, { ...pluginFixture().http, 'my-auth': myAuth });
      },
    };
    const { user, admin } = await openEditor('#/consumers/new?from=src&tab=json', { objects: { consumers: [SOURCE] }, replies });
    // The source has been read and the list asked for, and while the list loads there is no copy at
    // all: no editor (no Create), nothing of the source on the page.
    await waitFor(() => expect(admin.requests.map((r) => r.url.pathname)).toEqual(expect.arrayContaining([expect.stringMatching(/consumers\/src$/), expect.stringMatching(/plugins$/)]) as string[]));
    await new Promise((r) => setTimeout(r, 50));
    expect(main().queryByRole('button', { name: t('editor.create') })).toBeNull();
    expect(document.body.innerHTML).not.toContain('SEKRET-1');
    release();
    await main().findByRole('button', { name: t('editor.create') });
    const box = await jsonEditor(t('kind.consumers.singular'));
    await waitFor(() => expect(box.textContent).toContain('"my-auth": {}'));
    expect(document.body.innerHTML).not.toMatch(/SEKRET-1|K-9/);
    expect(box.textContent).toContain('"limit-count"');
    const notes = [t('editor.copyNotice.secrets', { list: [t('editor.copyNotice.secretItem', { plugin: 'key-auth', fields: 'key' })].join(', ') }), t('editor.copyNotice.whole', { list: t('editor.copyNotice.noSecretFields', { plugin: 'my-auth' }) })];
    for (const note of notes) expect(notice()).toHaveTextContent(note);
    await user.click(main().getByRole('tab', { name: /^Plugins/ }));
    for (const note of notes) expect(notice()).toHaveTextContent(note);
  });

  it('the plugin list fails to load: fail closed (the built-in key-auth loses its key, a plugin not built in all of its settings) and the note says why', async () => {
    const replies = { plugins: () => json(503, { error_msg: 'down' }) };
    await openEditor('#/consumers/new?from=src&tab=json', { objects: { consumers: [SOURCE] }, replies });
    await main().findByRole('button', { name: t('editor.create') });
    const box = await jsonEditor(t('kind.consumers.singular'));
    await waitFor(() => expect(box.textContent).toContain('"my-auth": {}'));
    expect(document.body.innerHTML).not.toMatch(/SEKRET-1|K-9/);
    expect(box.textContent).toContain('"time_window": 1');
    expect(notice()).toHaveTextContent(t('editor.copyNotice.secrets', { list: [t('editor.copyNotice.secretItem', { plugin: 'key-auth', fields: 'key' })].join(', ') }));
    expect(notice()).toHaveTextContent(t('editor.copyNotice.whole', { list: t('editor.copyNotice.unloaded', { plugin: 'my-auth' }) }));
  });
});

describe('what a copy left out is shown where it cannot be missed', () => {
  const SOURCE: Obj = {
    username: 'src',
    plugins: { 'my-plugin': { token: 'T-1' }, 'basic-auth': { username: 'src-user', password: 'PW-1' }, 'jwt-auth': { key: 'src-jwt', secret: 'S-1' } },
  };

  it('the plugin list failed: the notice is on every tab from the start (General first), says why a plugin not built in was left out, and names the lookup fields the copy still shares', async () => {
    const replies = { plugins: () => json(503, { error_msg: 'down' }) };
    const { user } = await openEditor('#/consumers/new?from=src', { objects: { consumers: [SOURCE] }, replies });
    await main().findByRole('button', { name: t('editor.create') });
    const removed = [t('editor.copyNotice.secrets', { list: [t('editor.copyNotice.secretItem', { plugin: 'basic-auth', fields: 'password' }), t('editor.copyNotice.secretItem', { plugin: 'jwt-auth', fields: 'secret' })].join(', ') }), t('editor.copyNotice.whole', { list: t('editor.copyNotice.unloaded', { plugin: 'my-plugin' }) })];
    const shared = t('editor.copyNotice.shared', { list: 'basic-auth username, jwt-auth key' });
    expect(main().getByRole('tab', { name: /^General/ })).toHaveAttribute('aria-selected', 'true');
    for (const tabName of [/^General/, /^Plugins/, /^Credentials/, /^JSON/]) {
      await user.click(main().getByRole('tab', { name: tabName }));
      for (const note of removed) expect(notice(), String(tabName)).toHaveTextContent(note);
      expect(notice(), String(tabName)).toHaveTextContent(shared);
    }
    expect(document.body.innerHTML).not.toMatch(/T-1|PW-1|S-1/);
  });

  it('the notes stay those of the draft they were made with: a refetch of the original with new secrets (window focus) changes neither', async () => {
    const { admin } = await openEditor('#/consumers/new?from=src', { objects: { consumers: [SOURCE] }, replies: pluginReplies() });
    await main().findByRole('button', { name: t('editor.create') });
    const before = notice().textContent;
    expect(before).toContain(t('editor.copyNotice.unknown', { plugin: 'my-plugin' }));
    admin.touch('consumers', 'src', { plugins: { ...(SOURCE.plugins as Obj), 'hmac-auth': { key_id: 'src-hmac', secret_key: 'HK-1' } } });
    const reads = () => admin.requests.filter((r) => r.method === 'GET' && r.url.pathname.endsWith('/consumers/src')).length;
    const first = reads();
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 60_000);
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(reads()).toBeGreaterThan(first));
    await new Promise((r) => setTimeout(r, 50));
    focusManager.setFocused(undefined);
    expect(notice().textContent).toBe(before);
    expect(notice().textContent).not.toContain('hmac-auth');
  });
});

describe("a consumer's custom auth plugin: its run options may matter (other phases), so they don't say \"never runs\"", () => {
  it('the note says its sign-in step does not run here, and other phases may', async () => {
    const myAuth = { schema: { type: 'object' }, type: 'auth', consumer_schema: { type: 'object' } };
    const replies = { plugins: () => json(200, { ...pluginFixture().http, 'my-auth': myAuth }) };
    const { user } = await openEditor('#/consumers/cu?tab=plugins', { objects: { consumers: [{ username: 'cu', plugins: { 'my-auth': { token: 't' } } }] }, replies });
    await main().findByRole('heading', { level: 1, name: 'cu' });
    await settled();
    const card = await main().findByRole('group', { name: 'my-auth' });
    await user.click(within(card).getByRole('button', { name: 'my-auth' }));
    await user.click(within(card).getByRole('button', { name: new RegExp(`^${t('pl.meta.title')}`) }));
    expect(within(card).getByText(t('pl.meta.signInCustom', { name: 'my-auth' }))).toBeInTheDocument();
    expect(card.textContent).not.toContain('never runs');
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
