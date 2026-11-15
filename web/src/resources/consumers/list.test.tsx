// The consumers list page: its credentials count per row, which follows a delete, and the header of
// that column, which does not sort.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { queryKeys, scopedKey } from '../../api/hooks';
import { resetReadOnlyKeys } from '../../api/write';
import { t } from '../../i18n';
import { ListPage } from '../../pages/ListPage';
import { DEV_CONN } from '../../test/app';
import { renderWithProviders } from '../../test/providers';

afterEach(() => {
  resetReadOnlyKeys();
  localStorage.clear();
});

const objects = { consumers: [{ username: 'alice', group_id: 'partners' }, { username: 'bob' }], consumer_groups: [{ id: 'partners', name: 'partners', plugins: {} }] };
const credentials = { alice: [{ id: 'a1', plugins: { 'key-auth': { key: 'k1' } } }, { id: 'a2', plugins: { 'key-auth': { key: 'k2' } } }] };

describe('the consumers list', () => {
  it('counts each row\'s credentials; the column header is a label, not a sort button', async () => {
    renderWithProviders(<ListPage kind="consumers" />, { path: '/consumers', objects, credentials });
    const alice = (await screen.findByRole('link', { name: 'alice' })).closest('tr') as HTMLElement;
    await waitFor(() => expect(within(alice).getByText('2')).toBeInTheDocument());
    const bob = screen.getByRole('link', { name: 'bob' }).closest('tr') as HTMLElement;
    await waitFor(() => expect(within(bob).getByText('0')).toBeInTheDocument());
    const header = screen.getByRole('columnheader', { name: t('column.credentials') });
    expect(within(header).queryByRole('button')).not.toBeInTheDocument();
    expect(within(screen.getByRole('columnheader', { name: t('column.username') })).getByRole('button')).toBeInTheDocument();
  });

  it("deleting a consumer also drops (or reloads) its credentials' query", async () => {
    const user = userEvent.setup();
    const { queryClient, admin } = renderWithProviders(<ListPage kind="consumers" />, { path: '/consumers', objects, credentials });
    const alice = (await screen.findByRole('link', { name: 'alice' })).closest('tr') as HTMLElement;
    await waitFor(() => expect(within(alice).getByText('2')).toBeInTheDocument());
    const key = scopedKey(DEV_CONN.id, queryKeys.list('credentials', { consumer: 'alice' }));
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);

    await user.click(within(alice).getByRole('button', { name: t('table.actionsFor', { name: 'alice' }) }));
    await user.click(await screen.findByRole('menuitem', { name: t('action.delete') }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: t('delete.confirm', { kind: t('kind.consumers.singular') }) }));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'alice' })).not.toBeInTheDocument());
    const paths = admin.requests.map((r) => `${r.method} ${r.url.pathname.replace(/^.*\/apisix\/admin\//, '')}`);
    const deleted = paths.indexOf('DELETE consumers/alice');
    expect(deleted).toBeGreaterThan(-1);
    // Never left as it was: dropped from the cache with the consumer (WriteOptions.forget, since fix
    // round 2 of Task 15), fetched again while its row was still shown, or marked stale.
    const refetched = paths.slice(deleted + 1).includes('GET consumers/alice/credentials');
    const state = queryClient.getQueryState(key);
    expect(state === undefined || refetched || state.isInvalidated).toBe(true);
  });
});
