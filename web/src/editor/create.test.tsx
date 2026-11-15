// Create never overwrites: APISIX takes a PUT to an id that exists as a replace, so the editor looks
// before it creates with a chosen id (a typed ID, a consumer's username), and refuses when the id is
// taken, naming what has it and linking to it. Page level, on a fake Admin API.
import { screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Kind, Obj } from '../api/types';
import { resetReadOnlyKeys } from '../api/write';
import { t } from '../i18n';
import { resetApp } from '../test/app';
import { main, openEditor, writesOf } from '../test/editor';
import { json, type FakeAdminOptions } from '../test/fakeAdmin';
import { pluginReplies } from '../test/plugins';
import { getToasts } from '../ui/toast';

beforeAll(async () => {
  await import('../resources/consumers/bodies');
  await import('../resources/credentials/bodies');
  await import('../resources/consumer_groups/bodies');
  await import('../resources/routes/bodies');
});

afterEach(() => {
  resetApp();
  resetReadOnlyKeys();
});

const ALICE: Obj = { username: 'alice', desc: 'Partner', plugins: { 'key-auth': { key: 'alice-key' } } };
const PARTNERS: Obj = { id: 'partners', name: 'partners', plugins: { 'limit-count': { count: 1, time_window: 1 } } };
const R1: Obj = { id: 'r1', name: 'theirs', uri: '/theirs', upstream_id: 'u1' };
const C1: Obj = { id: 'c1', name: 'theirs', plugins: { 'key-auth': { key: 'their-key' } } };
const OPTS: FakeAdminOptions = {
  objects: { consumers: [ALICE, { username: 'jo' }], consumer_groups: [PARTNERS], routes: [R1], upstreams: [{ id: 'u1', nodes: [{ host: 'a', port: 80, weight: 1 }] }] },
  credentials: { jo: [C1] },
  replies: pluginReplies(),
};

async function settled() {
  const panel = await main().findByRole('tabpanel');
  await waitFor(() => expect(panel.querySelector('.ed-lazy__loading')).toBeNull());
}

/** Each kind's create page, how to type the id, and what the stored object is. */
const CASES: { kind: string; hash: string; typeId: (user: UserEvent, id: string) => Promise<void>; taken: string; free: string; field: () => HTMLElement; stored: Obj; storedOf: (admin: { stored: (kind: Kind, consumer?: string) => Obj[] }) => Obj[]; singular: string; inline: boolean }[] = [
  {
    kind: 'consumers',
    hash: '#/consumers/new',
    typeId: async (user, id) => user.type(main().getByRole('textbox', { name: /^Username/ }), id),
    taken: 'alice',
    free: 'bob',
    field: () => main().getByRole('textbox', { name: /^Username/ }),
    stored: ALICE,
    storedOf: (admin) => admin.stored('consumers'),
    singular: 'Consumer',
    inline: true,
  },
  {
    kind: 'credentials',
    hash: '#/consumers/jo/credentials/new',
    typeId: async (user, id) => user.type(main().getByRole('textbox', { name: /^ID/ }), id),
    taken: 'c1',
    free: 'c2',
    field: () => main().getByRole('textbox', { name: /^ID/ }),
    stored: C1,
    storedOf: (admin) => admin.stored('credentials', 'jo'),
    singular: 'Credential',
    // Credentials are not in the Ctx: only the check before the create knows.
    inline: false,
  },
  {
    kind: 'consumer_groups',
    hash: '#/consumer_groups/new',
    typeId: async (user, id) => user.type(main().getByRole('textbox', { name: /^ID/ }), id),
    taken: 'partners',
    free: 'staff',
    field: () => main().getByRole('textbox', { name: /^ID/ }),
    stored: PARTNERS,
    storedOf: (admin) => admin.stored('consumer_groups'),
    singular: 'Consumer Group',
    inline: true,
  },
  {
    kind: 'routes',
    hash: '#/routes/new?upstream_id=u1',
    typeId: async (user, id) => user.type(main().getByRole('textbox', { name: /^ID/ }), id),
    taken: 'r1',
    free: 'r2',
    field: () => main().getByRole('textbox', { name: /^ID/ }),
    stored: R1,
    storedOf: (admin) => admin.stored('routes'),
    singular: 'Route',
    inline: true,
  },
];

describe.each(CASES)('$kind', (c) => {
  it('an id another object has: Create writes nothing, says so on the field, in the banner and in a toast, with a link to it', async () => {
    const { user, admin } = await openEditor(c.hash, OPTS);
    await main().findByRole('button', { name: t('editor.create') });
    await settled();
    await c.typeId(user, c.taken);
    const message = t('editor.taken.message', { kind: c.singular, id: c.taken });
    if (c.inline) await waitFor(() => expect(c.field()).toHaveAccessibleDescription(message));
    else expect(c.field()).not.toHaveAccessibleDescription(message);

    await user.click(main().getByRole('button', { name: t('editor.create') }));
    const banner = await main().findByRole('alert');
    expect(banner).toHaveTextContent(t('editor.taken.title'));
    expect(banner).toHaveTextContent(message);
    const open = t('editor.taken.open', { kind: c.singular, id: c.taken });
    expect(within(banner).getByRole('link', { name: open })).toHaveAttribute('href', expect.stringContaining(encodeURIComponent(c.taken)) as string);
    expect(writesOf(admin)).toEqual([]);
    expect(c.storedOf(admin)).toEqual([c.stored, ...(c.kind === 'consumers' ? [{ username: 'jo' }] : [])]);
    expect(getToasts().at(-1)).toMatchObject({ tone: 'error', message, action: { label: open } });
    await waitFor(() => expect(c.field()).toHaveAccessibleDescription(message));
  });

  it('a free id: created', async () => {
    const { user, admin } = await openEditor(c.hash, OPTS);
    await main().findByRole('button', { name: t('editor.create') });
    await settled();
    await c.typeId(user, c.free);
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.method).toBe('PUT');
  });
});

describe('the check itself fails', () => {
  it('a GET that fails for another reason than 404 refuses the create too, and says why', async () => {
    const { user, admin } = await openEditor('#/consumers/new', { ...OPTS, replies: { ...OPTS.replies, 'consumers/bob': (req) => (req.method === 'GET' ? json(503, { error_msg: 'etcd unavailable' }) : undefined) } });
    await main().findByRole('button', { name: t('editor.create') });
    await settled();
    await user.type(main().getByRole('textbox', { name: /^Username/ }), 'bob');
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    expect(await main().findByRole('alert')).toHaveTextContent(t('editor.taken.unchecked', { id: 'bob', error: 'etcd unavailable' }));
    expect(writesOf(admin)).toEqual([]);
  });
});

describe("a copy's id", () => {
  it('Duplicate of a route and the same ID typed: refused like any other', async () => {
    const { user, admin } = await openEditor('#/routes/new?from=r1&tab=json', OPTS);
    await main().findByRole('button', { name: t('editor.create') });
    await user.type(main().getByRole('textbox', { name: /^ID/ }), 'r1');
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    expect(await main().findByRole('alert')).toHaveTextContent(t('editor.taken.message', { kind: 'Route', id: 'r1' }));
    expect(writesOf(admin)).toEqual([]);
    expect(screen.queryByText('Created')).toBeNull();
  });
});
