// The consumer editor's tabs, each rendered as the frame renders it (controlled by the draft).
import { screen, waitFor, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Obj } from '../../api/types';
import { t } from '../../i18n';
import { ctxOf, itemOf } from '../../test/ctx';
import { editableControls } from '../../test/schemaForm';
import { renderTab, type TabOptions } from '../../test/tab';
import { DraftPluginsTab } from '../../plugins/PluginsTab';
import type { TabProps } from '../registry';
import { CredentialsTab, GeneralTab } from './bodies';
import { consumerIssues } from './validate';

beforeAll(async () => {
  await import('../../schema-form/SchemaForm');
});

const PARTNERS = itemOf('partners', { name: 'Partners', plugins: { 'limit-count': { count: 1000, time_window: 3600 }, cors: { _meta: { disable: true } } } });
const CTX = ctxOf({ consumerGroups: [PARTNERS, itemOf('staff', { name: 'staff', plugins: {} })] });
const JO: Obj = { username: 'jo', desc: 'Jo', labels: { team: 'a' }, group_id: 'partners', plugins: { 'key-auth': { key: 'jo-key' }, 'limit-count': { count: 5, time_window: 60 } } };
const CREDS = { jo: [{ id: 'c1', name: 'first', plugins: { 'key-auth': { key: 'c1-key' } } }, { id: 'c2', plugins: { 'basic-auth': { username: 'u', password: 'pw' } } }] };

const tab = (Tab: ComponentType<TabProps>, draft: Obj, opts: TabOptions = {}) =>
  renderTab('consumers', Tab, draft, consumerIssues, { ctx: CTX, original: { id: typeof draft.username === 'string' ? draft.username : 'jo', value: draft }, ...opts, admin: { counts: {}, credentials: CREDS, ...opts.admin } });
const Plugins = (p: TabProps) => <DraftPluginsTab {...p} scope="consumer" />;

describe('General', () => {
  it('a new consumer: the username is a text box, checked as typed', async () => {
    const h = tab(GeneralTab, {}, { isNew: true, original: undefined });
    const username = screen.getByRole('textbox', { name: /^Username/ });
    await h.user.type(username, 'jo e');
    expect(h.value()).toEqual({ username: 'jo e' });
    expect(username).toHaveAccessibleDescription(new RegExp(t('cs.issue.usernamePattern')));
    await h.user.clear(username);
    await h.user.type(username, 'jo_e-1');
    expect(h.value()).toEqual({ username: 'jo_e-1' });
    expect(username).not.toHaveAttribute('aria-invalid');
  });

  it('a stored consumer: the username is plain text even while editing, with a hint to duplicate instead', () => {
    tab(GeneralTab, JO);
    expect(screen.queryByRole('textbox', { name: /^Username/ })).not.toBeInTheDocument();
    expect(screen.getByText('jo')).toHaveClass('mono');
    expect(screen.getByText(t('cs.general.usernameFixed'))).toBeInTheDocument();
  });

  it('edits the description and labels, and picks or clears the group', async () => {
    const h = tab(GeneralTab, { username: 'jo' });
    await h.user.type(screen.getByRole('textbox', { name: t('cs.general.desc') }), 'Jo');
    await h.user.click(screen.getByRole('combobox', { name: t('cs.general.group') }));
    await h.user.click(await screen.findByRole('option', { name: /^staff/ }));
    expect(h.value()).toEqual({ username: 'jo', desc: 'Jo', group_id: 'staff' });
    await h.user.click(screen.getByRole('button', { name: t('ui.select.clear') }));
    expect(h.value()).toEqual({ username: 'jo', desc: 'Jo' });
    await h.user.type(screen.getByRole('textbox', { name: 'Key 1' }), 'team');
    await h.user.type(screen.getByRole('textbox', { name: 'Value 1' }), 'a');
    expect(h.value()).toEqual({ username: 'jo', desc: 'Jo', labels: { team: 'a' } });
  });

  it('a group id the groups do not hold is flagged, but only once they have loaded', () => {
    tab(GeneralTab, { username: 'jo', group_id: 'gone' }, { locked: true });
    expect(screen.getByText(t('picker.notFound', { id: 'gone' }))).toBeInTheDocument();
  });

  it('while the groups load, a group id is shown as it is, never "not found"', () => {
    tab(GeneralTab, { username: 'jo', group_id: 'gone' }, { locked: true, ctx: ctxOf({ loaded: { consumerGroups: false } }) });
    expect(screen.getByText('gone')).toHaveClass('mono');
    expect(screen.queryByText(t('picker.notFound', { id: 'gone' }))).not.toBeInTheDocument();
  });

  it('locked: no form controls; at a glance, its own plugins, those from the group and its credentials', async () => {
    const { container } = tab(GeneralTab, JO, { locked: true });
    expect(editableControls(container)).toEqual([]);
    const overview = screen.getByRole('region', { name: t('cs.overview') });
    expect(overview).toHaveTextContent('key-auth, limit-count');
    expect(overview).toHaveTextContent(t('cs.overview.fromGroup', { names: 'cors (off), limit-count' }));
    await waitFor(() => expect(overview).toHaveTextContent(t('cs.overview.credentialCount', { count: 2 })));
    expect(overview.textContent).not.toContain('jo-key');
  });

  it('locked without a group: says "No group"; at a glance, "None" only when neither it nor its group has plugins', () => {
    tab(GeneralTab, { username: 'bob' }, { locked: true });
    expect(screen.getByText(t('cs.general.noGroup'))).toBeInTheDocument();
    expect(screen.getByRole('region', { name: t('cs.overview') })).toHaveTextContent(`${t('pl.tab')}${t('cs.overview.noPlugins')}`);
  });

  it('at a glance, a consumer with no plugins of its own lists only those from its group', () => {
    tab(GeneralTab, { username: 'jo', group_id: 'partners' }, { locked: true });
    const overview = screen.getByRole('region', { name: t('cs.overview') });
    expect(overview).toHaveTextContent(`${t('pl.tab')}${t('cs.overview.fromGroup', { names: 'cors (off), limit-count' })}`);
  });

  it('at a glance says "loading…" for the group\'s plugins while the groups load', () => {
    tab(GeneralTab, JO, { locked: true, ctx: ctxOf({ loaded: { consumerGroups: false } }) });
    const overview = screen.getByRole('region', { name: t('cs.overview') });
    expect(overview).toHaveTextContent(t('picker.loading'));
    expect(overview).not.toHaveTextContent(t('cs.overview.fromGroup', { names: '' }).trim());
  });
});

describe('Plugins', () => {
  it("lists the group's plugins as inherited, from the consumer group; the consumer's own wins a name in both", async () => {
    tab(Plugins, JO, { locked: true });
    const inherited = await screen.findByRole('list', { name: t('pl.inherited.title') });
    const rows = within(inherited).getAllByRole('listitem').map((li) => li.textContent);
    expect(rows).toEqual([`cors${t('pl.inherited.fromConsumerGroup')}${t('pl.inherited.off')}`, `limit-count${t('pl.inherited.fromConsumerGroup')}${t('pl.inherited.overridden')}`]);
  });

  it('says "loading…" while the groups load, and lists nothing as inherited meanwhile', async () => {
    tab(Plugins, JO, { locked: true, ctx: ctxOf({ loaded: { consumerGroups: false } }) });
    expect(await screen.findByText(t('pl.inherited.groupLoading'))).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: t('pl.inherited.title') })).not.toBeInTheDocument();
  });

  it('without a group, nothing is inherited and nothing loads', async () => {
    tab(Plugins, { username: 'jo', plugins: {} }, { ctx: ctxOf({ loaded: { consumerGroups: false } }) });
    await screen.findByText(t('pl.empty'));
    expect(screen.queryByText(t('pl.inherited.groupLoading'))).not.toBeInTheDocument();
  });
});

describe('Credentials', () => {
  it("lists this consumer's credentials (one request, the name encoded), with Edit and Delete only", async () => {
    const h = tab(CredentialsTab, { username: 'jo e' }, { original: { id: 'jo e', value: { username: 'jo e' } }, admin: { credentials: { 'jo e': CREDS.jo } } });
    const region = await screen.findByRole('region', { name: t('kind.credentials.plural') });
    expect(await within(region).findByRole('link', { name: 'first' })).toHaveAttribute('href', '/consumers/jo%20e/credentials/c1');
    expect(within(region).getByRole('link', { name: 'c2' })).toBeInTheDocument();
    expect(h.admin.requests.filter((r) => r.url.pathname.includes('/credentials')).map((r) => r.url.pathname.replace(/^.*\/apisix\/admin\//, ''))).toEqual(['consumers/jo%20e/credentials']);
    expect(region.textContent).not.toContain('c1-key');
    // No bulk actions: no row checkboxes.
    expect(within(region).queryAllByRole('checkbox')).toEqual([]);

    await h.user.click(within(region).getByRole('button', { name: t('table.actionsFor', { name: 'first' }) }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual([t('action.edit'), t('action.delete')]);
    await h.user.click(within(menu).getByRole('menuitem', { name: t('action.edit') }));
    expect(h.router.state.location.pathname).toBe('/consumers/jo%20e/credentials/c1');
  });

  it('New links to a new credential of this consumer', async () => {
    tab(CredentialsTab, JO);
    const region = await screen.findByRole('region', { name: t('kind.credentials.plural') });
    expect(within(region).getByRole('link', { name: t('cs.credentials.new') })).toHaveAttribute('href', '/consumers/jo/credentials/new');
  });

  it.each([
    ['locked', true],
    ['editing', false],
  ])('%s: Delete asks first; confirmed, it deletes and the list is fetched again', async (_, locked) => {
    const h = tab(CredentialsTab, JO, { locked });
    const region = await screen.findByRole('region', { name: t('kind.credentials.plural') });
    await within(region).findByRole('link', { name: 'first' });
    expect(editableControls(region)).toEqual([]);
    await h.user.click(within(region).getByRole('button', { name: t('table.actionsFor', { name: 'first' }) }));
    await h.user.click(await screen.findByRole('menuitem', { name: t('action.delete') }));
    expect(h.admin.requests.filter((r) => r.method !== 'GET')).toEqual([]);
    const dialog = await screen.findByRole('alertdialog');
    await h.user.click(within(dialog).getByRole('button', { name: t('delete.confirm', { kind: t('kind.credentials.singular') }) }));
    await waitFor(() => expect(within(region).queryByRole('link', { name: 'first' })).not.toBeInTheDocument());
    const writes = h.admin.requests.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.url.pathname.replace(/^.*\/apisix\/admin\//, '')}`);
    expect(writes).toEqual(['DELETE consumers/jo/credentials/c1']);
    expect(h.admin.requests.filter((r) => r.method === 'GET' && r.url.pathname.endsWith('/consumers/jo/credentials'))).toHaveLength(2);
  });

  it('a consumer without credentials: says so, and offers New', async () => {
    tab(CredentialsTab, { username: 'bob' }, { original: { id: 'bob', value: { username: 'bob' } } });
    const region = await screen.findByRole('region', { name: t('kind.credentials.plural') });
    expect(await within(region).findByText(t('cs.credentials.none'))).toBeInTheDocument();
    expect(within(region).getAllByRole('link', { name: t('cs.credentials.new') }).length).toBeGreaterThan(0);
  });

  it('a new, unsaved consumer shows a note instead of the table', () => {
    tab(CredentialsTab, { username: 'jo' }, { isNew: true, original: undefined });
    expect(screen.getByText(t('cs.credentials.newNote'))).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
