// An editor that holds a draft is never unmounted or replaced by anything the network does: a
// background refetch (window focus, invalidation) whose answer arrives late, fails, finds nothing or
// finds the object, on a create-when-missing page and on a stored object's page. Only the user (or a
// successful save) replaces it. The replies are delayed, as on a real network: an instant fake reply
// lets React batch the in-between states away.
import { act, screen, waitFor } from '@testing-library/react';
import { focusManager } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { Obj } from '../api/types';
import { t } from '../i18n';
import { EditorPage } from '../pages/EditorPage';
import { GENERAL_TAB, overrideDef } from '../test/editor';
import { json, type FakeRequest } from '../test/fakeAdmin';
import { renderWithProviders } from '../test/providers';

const undo: (() => void)[] = [];
afterEach(() => {
  for (const step of undo.splice(0)) step();
  focusManager.setFocused(undefined);
});

const later = (body: () => Response, ms = 60) => new Promise<Response>((resolve) => setTimeout(() => resolve(body()), ms));
const notFound = () => json(404, { message: 'Key not found' });

/** Answers GETs of one object: the first at once, every later one after a delay, from `answers` in turn (the last repeats). */
function gets(answers: (() => Response)[]) {
  let n = 0;
  return (req: FakeRequest) => {
    if (req.method !== 'GET') return undefined;
    const answer = answers[Math.min(n, answers.length - 1)] ?? notFound;
    n++;
    return n === 1 ? answer() : later(answer);
  };
}

/** Focus leaves and comes back (the user switched browser tabs), then the late answers arrive. */
async function refocus() {
  act(() => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  await act(() => new Promise((resolve) => setTimeout(resolve, 150)));
}

const nameBox = () => screen.getByRole('textbox', { name: 'Name' });

describe('a create-when-missing page', () => {
  const open = (answers: (() => Response)[]) => {
    undo.push(overrideDef('consumer_groups', { createWhenMissing: true, tabs: [GENERAL_TAB], validate: () => [] }));
    const user = userEvent.setup();
    const app = renderWithProviders(<EditorPage kind="consumer_groups" id="fresh" />, { path: '/consumer_groups/fresh', counts: {}, replies: { 'consumer_groups/fresh': gets(answers) } });
    return { user, ...app };
  };

  it('keeps what was typed through a refetch that answers late with another 404', async () => {
    const { user } = open([notFound]);
    await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'typed');
    await refocus();
    expect(nameBox()).toHaveValue('typed');
    expect(screen.queryByRole('status', { name: t('editor.loading', { kind: t('kind.consumer_groups.singular') }) })).not.toBeInTheDocument();
  });

  it('keeps it through a refetch that fails', async () => {
    const { user } = open([notFound, () => json(500, { error_msg: 'etcd down' })]);
    await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'typed');
    await refocus();
    expect(nameBox()).toHaveValue('typed');
  });

  it('keeps it when a refetch finds the object stored meanwhile, says so, and shows it only when asked', async () => {
    const stored = () => json(200, { key: '/apisix/consumer_groups/fresh', value: { id: 'fresh', name: 'theirs', plugins: {} }, modifiedIndex: 9 });
    const { user } = open([notFound, stored]);
    await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'typed');
    await refocus();
    expect(nameBox()).toHaveValue('typed');
    const notice = await screen.findByRole('note', { name: t('editor.foundMeanwhile.title') });
    expect(notice).toHaveTextContent(t('editor.foundMeanwhile.body', { kind: t('kind.consumer_groups.singular'), id: 'fresh' }));
    await user.click(screen.getByRole('button', { name: t('editor.taken.show') }));
    expect(await screen.findByRole('button', { name: t('editor.edit') })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'theirs' })).toBeInTheDocument();
  });

  it('a first read that fails for another reason than 404 shows the load error, not the create form', async () => {
    open([() => json(500, { error_msg: 'etcd down' })]);
    expect(await screen.findByRole('alert')).toHaveTextContent(t('editor.loadFailed', { kind: t('kind.consumer_groups.singular'), id: 'fresh' }));
    expect(screen.queryByRole('button', { name: t('editor.create') })).not.toBeInTheDocument();
  });
});

describe("a stored object's page with unsaved changes", () => {
  const GROUP: Obj = { id: 'g1', name: 'stored', plugins: {} };

  it('keeps the draft through a refetch that answers late with 404 (deleted elsewhere) or fails', async () => {
    undo.push(overrideDef('consumer_groups', { tabs: [GENERAL_TAB], validate: () => [] }));
    const user = userEvent.setup();
    const ok = () => json(200, { key: '/apisix/consumer_groups/g1', value: GROUP, modifiedIndex: 3 });
    const { queryClient } = renderWithProviders(<EditorPage kind="consumer_groups" id="g1" />, {
      path: '/consumer_groups/g1',
      counts: {},
      replies: { 'consumer_groups/g1': gets([ok, notFound, () => json(500, { error_msg: 'etcd down' })]) },
    });
    await screen.findByRole('heading', { level: 1, name: 'stored' });
    await user.keyboard('e');
    await user.type(nameBox(), '!');
    for (let i = 0; i < 2; i++) {
      await act(() => queryClient.invalidateQueries());
      await act(() => new Promise((resolve) => setTimeout(resolve, 150)));
      expect(nameBox()).toHaveValue('stored!');
    }
    await waitFor(() => expect(screen.getByRole('button', { name: t('editor.save') })).toBeInTheDocument());
  });
});
