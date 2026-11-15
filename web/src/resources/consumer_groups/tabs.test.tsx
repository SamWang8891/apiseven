// The consumer group editor's tabs, each rendered as the frame renders it (controlled by the draft).
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { describe, expect, it } from 'vitest';
import type { Item, Obj } from '../../api/types';
import { t } from '../../i18n';
import { ctxOf } from '../../test/ctx';
import { editableControls } from '../../test/schemaForm';
import { renderTab, type TabOptions } from '../../test/tab';
import type { TabProps } from '../registry';
import { GeneralTab, MembersTab } from './bodies';
import { consumerGroupIssues } from './validate';

const consumer = (username: string, group_id?: unknown): Item => ({ id: username, value: { username, group_id, desc: `${username}'s` } });
const CTX = ctxOf({ consumers: [consumer('alice', 'partners'), consumer('ann', 'partners'), consumer('sam', 'staff'), consumer('bob')] });
const PARTNERS: Obj = { id: 'partners', name: 'Partners', desc: 'External partners', labels: { tier: 'partner' }, plugins: { 'limit-count': { count: 1000, time_window: 3600 } } };

const tab = (Tab: ComponentType<TabProps>, draft: Obj, opts: TabOptions = {}) =>
  renderTab('consumer_groups', Tab, draft, consumerGroupIssues, { ctx: CTX, original: { id: typeof draft.id === 'string' ? draft.id : 'partners', value: draft }, ...opts, admin: { counts: {}, credentials: {}, ...opts.admin } });

describe('General', () => {
  it('edits name, description and labels', async () => {
    const h = tab(GeneralTab, { id: 'partners', plugins: {} });
    await h.user.type(screen.getByRole('textbox', { name: t('cg.general.name') }), 'P');
    await h.user.type(screen.getByRole('textbox', { name: t('cg.general.desc') }), 'D');
    expect(h.value()).toEqual({ id: 'partners', plugins: {}, name: 'P', desc: 'D' });
  });

  it('locked: no form controls', () => {
    const { container } = tab(GeneralTab, PARTNERS, { locked: true });
    expect(editableControls(container)).toEqual([]);
    expect(screen.getByText('External partners')).toBeInTheDocument();
  });
});

describe('Consumers (members)', () => {
  it('lists only the consumers whose group is this one, with Edit only', async () => {
    const h = tab(MembersTab, PARTNERS);
    const region = await screen.findByRole('region', { name: t('cg.tab.members') });
    expect(within(region).getByRole('link', { name: 'alice' })).toHaveAttribute('href', '/consumers/alice');
    expect(within(region).getByRole('link', { name: 'ann' })).toBeInTheDocument();
    expect(within(region).queryByText('sam')).not.toBeInTheDocument();
    expect(within(region).queryByText('bob')).not.toBeInTheDocument();
    expect(within(region).queryAllByRole('checkbox')).toEqual([]);
    expect(within(region).getByText(t('cg.members.help'))).toBeInTheDocument();

    await h.user.click(within(region).getByRole('button', { name: t('table.actionsFor', { name: 'ann' }) }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual([t('action.edit')]);
    await h.user.click(within(menu).getByRole('menuitem', { name: t('action.edit') }));
    expect(h.router.state.location.pathname).toBe('/consumers/ann');
  });

  it('a group whose id is a number lists the consumers that name it as one', async () => {
    tab(MembersTab, { id: '7', plugins: {} }, { ctx: ctxOf({ consumers: [consumer('num', 7), consumer('text', '7'), consumer('other', 8)] }), original: { id: '7', value: { id: '7' } } });
    const region = await screen.findByRole('region', { name: t('cg.tab.members') });
    expect(within(region).getByRole('link', { name: 'num' })).toBeInTheDocument();
    expect(within(region).getByRole('link', { name: 'text' })).toBeInTheDocument();
    expect(within(region).queryByText('other')).not.toBeInTheDocument();
  });

  it('locked: no form controls; the table is still a list to work with (page size)', async () => {
    tab(MembersTab, PARTNERS, { locked: true });
    const region = await screen.findByRole('region', { name: t('cg.tab.members') });
    expect(editableControls(region)).toEqual([]);
    expect(within(region).getByRole('combobox', { name: t('table.page.size') })).toBeEnabled();
  });

  it('the new-consumer link starts a consumer in this group', async () => {
    tab(MembersTab, PARTNERS);
    const region = await screen.findByRole('region', { name: t('cg.tab.members') });
    expect(within(region).getByRole('link', { name: t('cg.members.new') })).toHaveAttribute('href', '/consumers/new?group_id=partners');
  });

  it('while the consumers load, the table says so; with none in the group, it says that', async () => {
    tab(MembersTab, PARTNERS, { ctx: ctxOf({ loaded: { consumers: false } }) });
    const region = await screen.findByRole('region', { name: t('cg.tab.members') });
    expect(within(region).getByRole('status', { name: t('table.loading', { plural: t('kind.consumers.plural') }) })).toBeInTheDocument();
    expect(region.querySelectorAll('.tbl-skeleton').length).toBeGreaterThan(0);
    expect(within(region).queryByText(t('cg.members.none'))).not.toBeInTheDocument();
    expect(within(region).queryByRole('link', { name: 'alice' })).not.toBeInTheDocument();
    cleanup();
    tab(MembersTab, { id: 'lonely', plugins: {} }, { original: { id: 'lonely', value: { id: 'lonely' } } });
    await waitFor(() => expect(screen.getByText(t('cg.members.none'))).toBeInTheDocument());
  });

  it('a new, unsaved group shows a note instead of the table', () => {
    tab(MembersTab, { plugins: {} }, { isNew: true, original: undefined });
    expect(screen.getByText(t('cg.members.newNote'))).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
