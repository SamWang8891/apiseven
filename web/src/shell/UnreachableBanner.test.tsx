import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { queryKeys, scopedKey, useList } from '../api/hooks';
import { resetReachability } from '../api/reachability';
import { t } from '../i18n';
import { renderWithProviders } from '../test/providers';
import { UnreachableBanner } from './UnreachableBanner';

// Fix round 1, R2: the banner says only what is known.

afterEach(() => resetReachability());

function Routes() {
  const list = useList('routes');
  return <p>{list.data ? `${list.data.length} routes` : list.error ? 'failed' : 'loading'}</p>;
}

function setup() {
  const mode = { down: false, status: 200 };
  const view = renderWithProviders(
    <>
      <UnreachableBanner />
      <Routes />
    </>,
    {
      counts: {},
      objects: { routes: [{ id: 'r1', uri: '/' }] },
      replies: { routes: () => (mode.down ? 'network' : mode.status === 200 ? undefined : new Response(JSON.stringify({ error_msg: 'nope' }), { status: mode.status })) },
    },
  );
  return { mode, ...view, user: userEvent.setup() };
}

const banner = () => screen.queryByText(t('unreachable.title'));

describe('the unreachable banner', () => {
  it('a read with no answer raises it; an answer of any kind, a 500 included, clears it', async () => {
    const { mode, queryClient } = setup();
    await screen.findByText('1 routes');
    expect(banner()).not.toBeInTheDocument();
    mode.down = true;
    await act(() => queryClient.refetchQueries());
    expect(banner()).toBeInTheDocument();
    mode.down = false;
    mode.status = 500;
    await act(() => queryClient.refetchQueries());
    await waitFor(() => expect(banner()).not.toBeInTheDocument());
  });

  it('data the app writes into the cache itself is no answer: it does not clear it', async () => {
    const { mode, queryClient, client } = setup();
    await screen.findByText('1 routes');
    mode.down = true;
    await act(() => queryClient.refetchQueries());
    expect(banner()).toBeInTheDocument();
    // What the editor's "Show stored" / "Reload theirs" do: setQueryData with data it already had.
    act(() => {
      queryClient.setQueryData(scopedKey(client.conn.id, queryKeys.list('routes')), []);
    });
    expect(banner()).toBeInTheDocument();
  });

  it('Try again asks again; with APISIX back, it goes', async () => {
    const { mode, queryClient, user } = setup();
    await screen.findByText('1 routes');
    mode.down = true;
    await act(() => queryClient.refetchQueries());
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('http://apisix.test:9180');
    mode.down = false;
    await user.click(within(alert).getByRole('button', { name: t('table.retry') }));
    await waitFor(() => expect(banner()).not.toBeInTheDocument());
  });
});
