// Plugin metadata at page level, on a fake Admin API: the list joins every plugin with metadata
// settings and the stored entries; a plugin's page exists whether or not an entry does; Reset deletes;
// secrets stay masked; create never overwrites.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Obj } from '../../api/types';
import { resetReadOnlyKeys } from '../../api/write';
import { t } from '../../i18n';
import { MASK } from '../../schema/secrets';
import { resetApp } from '../../test/app';
import { main, openEditor, writesOf } from '../../test/editor';
import { json, type FakeAdminOptions } from '../../test/fakeAdmin';
import { pluginFixture } from '../../test/pluginFixture';
import { pluginReplies } from '../../test/plugins';
import { editableControls } from '../../test/schemaForm';
import { getToasts } from '../../ui/toast';

beforeAll(async () => {
  await import('./bodies');
  await import('../../schema-form/SchemaForm');
});

afterEach(() => {
  resetApp();
  resetReadOnlyKeys();
});

const AZURE: Obj = { id: 'azure-functions', master_apikey: 'key-1', master_clientid: 'cid' };
const LOGGER: Obj = { id: 'http-logger', log_format: { host: '$host' }, x_future: { kept: true } };
const CUSTOM: Obj = { id: 'my-custom', anything: 'opaque-value' };
const KEYAUTH: Obj = { id: 'key-auth', note: 'free-form' };
const WITH_METADATA = Object.entries(pluginFixture().http).filter(([, info]) => info.metadata_schema).map(([name]) => name);

async function openList(stored: Obj[], opts: FakeAdminOptions = {}) {
  const app = await openEditor('#/plugin_metadata', { objects: { plugin_metadata: stored }, replies: { ...pluginReplies(), ...opts.replies } });
  await main().findByRole('heading', { level: 1, name: t('kind.plugin_metadata.plural') });
  return app;
}

const rowOf = async (name: string) => (await main().findByRole('link', { name })).closest('tr') as HTMLElement;
const save = (user: UserEvent) => user.click(main().getByRole('button', { name: t('editor.save') }));
const create = (user: UserEvent) => user.click(main().getByRole('button', { name: t('editor.create') }));

async function settled() {
  const panel = await main().findByRole('tabpanel');
  await waitFor(() => expect(panel.querySelector('.ed-lazy__loading')).toBeNull());
  return panel;
}

describe('the plugin metadata list', () => {
  it('lists http-logger as "Not set" when nothing is stored, and its page creates it with PUT /plugin_metadata/http-logger', async () => {
    const { user, admin } = await openList([]);
    const row = await rowOf('http-logger');
    expect(within(row).getByText(t('pm.state.notSet'))).toBeInTheDocument();
    await user.click(within(row).getByRole('link', { name: 'http-logger' }));
    await waitFor(() => expect(window.location.hash).toBe('#/plugin_metadata/http-logger'));
    // Nothing stored: the page opens unlocked, as a new entry for that plugin (no ID field).
    expect(await main().findByRole('heading', { level: 1, name: 'http-logger' })).toBeInTheDocument();
    await settled();
    expect(main().queryByRole('textbox', { name: /^ID/ })).not.toBeInTheDocument();
    expect(main().getByText(t('pm.config.notSet', { name: 'http-logger' }))).toBeInTheDocument();
    await user.type(await main().findByRole('spinbutton', { name: 'max_pending_entries' }), '100');
    await create(user);
    await waitFor(() => expect(writesOf(admin)).toEqual([{ method: 'PUT', path: 'plugin_metadata/http-logger', body: { max_pending_entries: 100 } }]));
    // The stored entry, locked, on the same page.
    expect(await main().findByRole('button', { name: t('editor.edit') })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/plugin_metadata/http-logger');
    expect(admin.stored('plugin_metadata')).toEqual([{ id: 'http-logger', max_pending_entries: 100 }]);
  });

  it('is the union of the plugins with metadata settings and the stored entries; an entry for a plugin not loaded, or without a metadata schema, is flagged', async () => {
    await openList([AZURE, LOGGER, CUSTOM, KEYAUTH]);
    await rowOf('kafka-logger');
    const names = [...main().getAllByRole('link')].map((a) => a.textContent).filter((name) => name && !name.startsWith(t('page.new', { kind: '' }).trim()));
    for (const name of WITH_METADATA) expect(names, name).toContain(name);
    expect(names).toEqual(expect.arrayContaining(['my-custom', 'key-auth']));
    expect(within(await rowOf('azure-functions')).getByText(t('pm.state.configured'))).toBeInTheDocument();
    expect(within(await rowOf('kafka-logger')).getByText(t('pm.state.notSet'))).toBeInTheDocument();
    const custom = await rowOf('my-custom');
    expect(within(custom).getByText(t('pm.state.configured'))).toBeInTheDocument();
    expect(within(custom).getByText(t('pm.state.unknown'))).toHaveAttribute('title', t('pm.state.unknownWhy'));
    expect(within(await rowOf('key-auth')).getByText(t('pm.state.noSchema'))).toBeInTheDocument();
    expect(within(await rowOf('http-logger')).queryByText(t('pm.state.unknown'))).not.toBeInTheDocument();
  });

  it('says nothing definite while the plugin list loads: no Configured / Not set, the table loading', async () => {
    let release!: () => void;
    const held = new Promise<undefined>((resolve) => (release = () => resolve(undefined)));
    await openList([AZURE], { replies: { plugins: () => held.then(() => json(200, pluginFixture().http)) } });
    await waitFor(() => expect(main().getByRole('status', { name: t('table.loading', { plural: t('kind.plugin_metadata.plural') }) })).toBeInTheDocument());
    expect(main().queryByText(t('pm.state.configured'))).not.toBeInTheDocument();
    expect(main().queryByText(t('pm.state.notSet'))).not.toBeInTheDocument();
    release();
    expect(within(await rowOf('azure-functions')).getByText(t('pm.state.configured'))).toBeInTheDocument();
  });

  it('falls back to the stored entries when the plugin list fails: no Not set rows, edited as JSON', async () => {
    const { user } = await openList([AZURE, CUSTOM], { replies: { plugins: () => json(500, { error_msg: 'boom' }) } });
    expect(await main().findByText(/The plugin list didn't load/)).toBeInTheDocument();
    await rowOf('my-custom');
    expect(main().queryByRole('link', { name: 'http-logger' })).not.toBeInTheDocument();
    expect(main().queryByText(t('pm.state.notSet'))).not.toBeInTheDocument();
    expect(main().queryByText(t('pm.state.unknown'))).not.toBeInTheDocument();
    await user.click(main().getByRole('link', { name: 'azure-functions' }));
    await main().findByRole('heading', { level: 1, name: 'azure-functions' });
    expect(await main().findByText(/edit the entry on the JSON tab/)).toBeInTheDocument();
  });

  it('Reset is offered only for a configured plugin, asks first, deletes, and the row is Not set again', async () => {
    const { user, admin } = await openList([AZURE]);
    const notSet = await rowOf('kafka-logger');
    await user.click(within(notSet).getByRole('button', { name: t('table.actionsFor', { name: 'kafka-logger' }) }));
    expect((await screen.findByRole('menu')).textContent).toBe(t('action.edit'));
    await user.keyboard('{Escape}');
    const row = await rowOf('azure-functions');
    await user.click(within(row).getByRole('button', { name: t('table.actionsFor', { name: 'azure-functions' }) }));
    await user.click(await screen.findByRole('menuitem', { name: t('action.reset') }));
    const dialog = await screen.findByRole('alertdialog', { name: t('delete.reset.title', { kind: t('kind.plugin_metadata.singular'), name: 'azure-functions' }) });
    expect(writesOf(admin)).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: t('action.reset') }));
    await waitFor(() => expect(writesOf(admin)).toEqual([{ method: 'DELETE', path: 'plugin_metadata/azure-functions', body: undefined }]));
    await waitFor(async () => expect(within(await rowOf('azure-functions')).getByText(t('pm.state.notSet'))).toBeInTheDocument());
  });

  it("the settings summary masks the metadata schema's secret fields, and the search can't find an entry by one", async () => {
    const { user } = await openList([AZURE, LOGGER]);
    const row = await rowOf('azure-functions');
    expect(row).toHaveTextContent(`master_apikey=${MASK}`);
    expect(row).toHaveTextContent('master_clientid=cid');
    expect(screen.getByRole('main').textContent ?? '').not.toContain('key-1');
    const search = main().getByRole('searchbox', { name: t('table.search.label', { plural: t('kind.plugin_metadata.plural') }) });
    await user.type(search, 'key-1');
    await waitFor(() => expect(main().queryByRole('link', { name: 'azure-functions' })).not.toBeInTheDocument());
    await user.clear(search);
    await user.type(search, 'cid');
    expect(await main().findByRole('link', { name: 'azure-functions' })).toBeInTheDocument();
    expect(main().queryByRole('link', { name: 'http-logger' })).not.toBeInTheDocument();
  });
});

describe("a plugin's metadata page", () => {
  const open = (stored: Obj[], hash: string, replies: FakeAdminOptions['replies'] = {}) =>
    openEditor(hash, { objects: { plugin_metadata: stored }, replies: { ...pluginReplies(), ...replies } });

  it('a metadata schema with a pattern the browser cannot read: the same note as a plugin card, and no issue from it (fix round 1, R5.3)', async () => {
    const http = { ...pluginFixture().http, 'my-logger': { metadata_schema: { type: 'object', properties: { tag: { type: 'string', pattern: '\\Afoo\\z' } } }, schema: { type: 'object' } } };
    const { user, admin } = await open([], '#/plugin_metadata/my-logger', { plugins: (req) => (req.url.searchParams.get('subsystem') === 'stream' ? undefined : json(200, http)) });
    await main().findByRole('button', { name: t('editor.create') });
    await settled();
    expect(await main().findByText(t('sf.gaps.some', { parts: t('sf.gaps.patterns') }))).toBeInTheDocument();
    await user.type(main().getByRole('textbox', { name: 'tag' }), 'bar');
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(writesOf(admin)).toEqual([{ method: 'PUT', path: 'plugin_metadata/my-logger', body: { tag: 'bar' } }]));
  });

  it('opened locked: no form controls; no Duplicate, and Delete reads Reset', async () => {
    const { user } = await open([LOGGER], '#/plugin_metadata/http-logger');
    await main().findByRole('heading', { level: 1, name: 'http-logger' });
    const panel = await settled();
    await within(panel).findByText('log_format');
    expect(editableControls(panel)).toEqual([]);
    await user.click(main().getByRole('button', { name: t('editor.more') }));
    const items = within(await screen.findByRole('menu')).getAllByRole('menuitem').map((item) => item.textContent);
    expect(items).toEqual([t('action.viewJson'), t('action.reset')]);
  });

  it('a save leaves every field the form does not show, and unknown ones, as loaded (a full PUT: no PATCH for metadata)', async () => {
    const { user, admin } = await open([LOGGER], '#/plugin_metadata/http-logger');
    await main().findByRole('heading', { level: 1, name: 'http-logger' });
    await settled();
    await user.keyboard('e');
    await user.type(await main().findByRole('spinbutton', { name: 'max_pending_entries' }), '50');
    await save(user);
    await waitFor(() => expect(writesOf(admin)).toEqual([{ method: 'PUT', path: 'plugin_metadata/http-logger', body: { ...LOGGER, max_pending_entries: 50 } }]));
  });

  it('a value the schema refuses blocks Save, with a badge on Settings', async () => {
    const { user, admin } = await open([LOGGER], '#/plugin_metadata/http-logger');
    await main().findByRole('heading', { level: 1, name: 'http-logger' });
    await settled();
    await user.keyboard('e');
    await user.type(await main().findByRole('spinbutton', { name: 'max_pending_entries' }), '0');
    await save(user);
    expect(writesOf(admin)).toEqual([]);
    expect(getToasts().at(-1)?.message).toBe(t('editor.fixOne'));
    expect(main().getByRole('tab', { name: new RegExp(`^${t('pm.tab.config')}`) })).toHaveTextContent(t('ui.tabs.errors', { count: 1 }));
  });

  it("a secret field (the metadata schema's encrypt_fields) is masked locked, in the JSON tab and View JSON; two saves that leave it alone send it back as stored", async () => {
    const { user, admin } = await open([AZURE], '#/plugin_metadata/azure-functions');
    await main().findByRole('heading', { level: 1, name: 'azure-functions' });
    const panel = await settled();
    await within(panel).findByText('master_clientid');
    expect(screen.getByRole('main').textContent).not.toContain('key-1');
    await user.click(main().getByRole('tab', { name: new RegExp(`^${t('editor.json.tab')}`) }));
    const json = await screen.findByRole('textbox', { name: t('editor.json.label', { kind: t('kind.plugin_metadata.singular') }) });
    await waitFor(() => expect(json.textContent).toContain(MASK));
    expect(json.textContent).not.toContain('key-1');
    await user.click(main().getByRole('button', { name: t('editor.more') }));
    await user.click(await screen.findByRole('menuitem', { name: t('action.viewJson') }));
    const view = await screen.findByRole('dialog');
    await waitFor(() => expect(view.textContent).toContain(MASK));
    expect(view.textContent).not.toContain('key-1');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(main().getByRole('tab', { name: new RegExp(`^${t('pm.tab.config')}`) }));
    for (const text of ['A', 'B']) {
      await main().findByRole('button', { name: t('editor.edit') });
      await user.keyboard('e');
      const id = await main().findByRole('textbox', { name: 'master_clientid' });
      await user.clear(id);
      await user.type(id, text);
      await save(user);
    }
    await waitFor(() => expect(writesOf(admin)).toHaveLength(2));
    for (const write of writesOf(admin)) expect(write.body?.master_apikey).toBe('key-1');
    expect(admin.stored('plugin_metadata')[0]).toMatchObject({ master_apikey: 'key-1', master_clientid: 'B' });
  });

  it('its page refuses to create when the entry was configured meanwhile, and offers what is stored instead (the stored entry unchanged)', async () => {
    let first = true;
    const { user, admin } = await open([LOGGER], '#/plugin_metadata/http-logger', {
      'plugin_metadata/http-logger': (req) => {
        if (req.method !== 'GET' || !first) return undefined;
        first = false;
        return json(404, { message: 'Key not found' });
      },
    });
    await main().findByRole('button', { name: t('editor.create') });
    await settled();
    await user.type(await main().findByRole('spinbutton', { name: 'max_pending_entries' }), '7');
    await create(user);
    const banner = await main().findByRole('alert');
    expect(banner).toHaveTextContent(t('editor.taken.title'));
    expect(writesOf(admin)).toEqual([]);
    expect(admin.stored('plugin_metadata')).toEqual([LOGGER]);
    await user.click(within(banner).getByRole('button', { name: t('editor.taken.show') }));
    expect(await main().findByRole('button', { name: t('editor.edit') })).toBeInTheDocument();
    expect(await main().findByText('$host')).toBeInTheDocument();
  });

  it("after a Reset from its page, the plugin's page is the create form again (the deleted entry is not shown as stored)", async () => {
    const { user, admin } = await open([AZURE], '#/plugin_metadata/azure-functions');
    await main().findByRole('heading', { level: 1, name: 'azure-functions' });
    await user.click(main().getByRole('button', { name: t('editor.more') }));
    await user.click(await screen.findByRole('menuitem', { name: t('action.reset') }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: t('action.reset') }));
    await waitFor(() => expect(window.location.hash).toBe('#/plugin_metadata'));
    const row = await rowOf('azure-functions');
    await waitFor(() => expect(within(row).getByText(t('pm.state.notSet'))).toBeInTheDocument());
    await user.click(within(row).getByRole('link', { name: 'azure-functions' }));
    expect(await main().findByRole('button', { name: t('editor.create') })).toBeInTheDocument();
    expect(main().queryByRole('button', { name: t('editor.edit') })).not.toBeInTheDocument();
    await settled();
    await user.type(await main().findByLabelText(/^master_apikey/), 'again');
    await create(user);
    await waitFor(() => expect(writesOf(admin).at(-1)).toEqual({ method: 'PUT', path: 'plugin_metadata/azure-functions', body: { master_apikey: 'again' } }));
  });

  it('New when the stored entries fail to load: every plugin with metadata settings is offered, and the page says why', async () => {
    const { user } = await open([], '#/plugin_metadata/new', { plugin_metadata: () => json(500, { error_msg: 'etcd down' }) });
    const picker = await main().findByRole('combobox', { name: /^Plugin/ });
    await waitFor(() => expect(picker).toBeEnabled());
    expect(main().getByText(/The stored entries didn't load/)).toBeInTheDocument();
    await user.click(picker);
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toContain('http-logger');
  });

  it("New with the plugin list down: the plugin's name is typed; a slash is refused at once, Save and Cmd/Ctrl-S send nothing, the toast names it", async () => {
    const { user, admin } = await open([], '#/plugin_metadata/new', { plugins: () => json(500, { error_msg: 'down' }) });
    const name = await main().findByRole('textbox', { name: /^Plugin/ });
    await user.type(name, 'a/b');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await create(user);
    expect(writesOf(admin)).toEqual([]);
    expect(getToasts().at(-1)?.message).toBe(t('editor.fixHeld', { fix: t('editor.fixOne'), message: t('pm.issue.slash', { id: 'a/b' }) }));
    await user.clear(name);
    await user.type(name, 'my-custom');
    await settled();
    await create(user);
    await waitFor(() => expect(writesOf(admin)).toEqual([{ method: 'PUT', path: 'plugin_metadata/my-custom', body: {} }]));
  });

  it('New picks a plugin with metadata settings and none stored, then creates it with PUT; one stored meanwhile is refused', async () => {
    const { user, admin } = await open([LOGGER], '#/plugin_metadata/new');
    const picker = await main().findByRole('combobox', { name: /^Plugin/ });
    await waitFor(() => expect(picker).toBeEnabled());
    await user.click(picker);
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(options).toContain('kafka-logger');
    expect(options).not.toContain('http-logger');
    await user.click(screen.getByRole('option', { name: 'kafka-logger' }));
    await settled();
    await user.type(await main().findByRole('spinbutton', { name: 'max_pending_entries' }), '9');
    await create(user);
    await waitFor(() => expect(writesOf(admin)).toEqual([{ method: 'PUT', path: 'plugin_metadata/kafka-logger', body: { max_pending_entries: 9 } }]));
    await waitFor(() => expect(window.location.hash).toBe('#/plugin_metadata/kafka-logger'));
  });
});
