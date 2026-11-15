// Save anyway (Task 16 B18): when Save is refused only because of local checks (a kind's validate:
// its …Issues and the plugin schemas), the refusal offers to send the draft as it is, and APISIX's
// answer decides. Never while a field holds input, never for the frame's own refusals; asked once per
// editing session; through the same save path as Save (PUT / POST / PATCH, the re-read, the conflict).
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { stripTimestamps } from '../api/sanitize';
import type { Obj } from '../api/types';
import { resetReadOnlyKeys } from '../api/write';
import { t } from '../i18n';
import type { TabDef } from '../resources/registry';
import { resetApp } from '../test/app';
import { GENERAL_TAB, jsonEditor, main, openEditor, overrideDef, writesOf } from '../test/editor';
import { json } from '../test/fakeAdmin';
import { pluginReplies } from '../test/plugins';
import { renderWithProviders } from '../test/providers';
import { EditorPage } from '../pages/EditorPage';
import { usePending } from '../ui';
import { getToasts } from '../ui/toast';

const undo: (() => void)[] = [];
afterEach(() => {
  for (const u of undo.splice(0)) u();
  resetApp();
  resetReadOnlyKeys();
});

const ROUTE: Obj = { id: 'r1', name: 'web', uri: '/a', upstream: { type: 'roundrobin', nodes: [{ host: '10.0.0.1', port: 80, weight: 1 }] }, create_time: 1700000000, update_time: 1700000100 };
/** A local check stricter than APISIX: it refuses every URI under /strict. */
const STRICT = 'the local check refuses /strict';
const strict = (d: Obj) => (typeof d.uri === 'string' && d.uri.startsWith('/strict') ? [{ path: 'uri', message: STRICT }] : []);

/** A tab whose field holds input it has not emitted while it shows "hold" (usePending). */
function Holder() {
  const [text, setText] = useState('');
  usePending(text === 'hold' ? 'Holder: not taken yet' : undefined);
  return <input aria-label="holder" aria-invalid={text === 'hold'} value={text} onChange={(e) => setText(e.target.value)} />;
}
const HOLDER_TAB: TabDef = { id: 'holder', label: 'Holder', fields: [], render: () => <Holder /> };

async function openRoute(opts: Parameters<typeof openEditor>[1] = {}, tabs: TabDef[] = [GENERAL_TAB]) {
  undo.push(overrideDef('routes', { tabs, validate: strict }));
  const app = await openEditor('#/routes/r1', { objects: { routes: [ROUTE] }, ...opts });
  await main().findByRole('heading', { level: 1, name: 'web' });
  return app;
}

type User = Awaited<ReturnType<typeof openEditor>>['user'];

async function setUri(user: User, uri: string) {
  const field = await screen.findByRole('textbox', { name: 'URI' });
  await user.clear(field);
  await user.type(field, uri);
}

const offer = () => main().queryByRole('region', { name: t('editor.anyway.title') });
/** Save anyway, in the sticky header beside Save, described by the notice above the tabs. */
const anywayButton = () => main().getByRole('button', { name: t('editor.anyway.action') });
const confirmDialog = () => screen.queryByRole('alertdialog', { name: t('editor.anyway.confirmTitle') });

/** Save is refused: no request, the usual toast, and the offer shows. */
async function refusedWithOffer(user: User, admin: Parameters<typeof writesOf>[0], how: 'button' | 'keys' = 'button') {
  const writes = writesOf(admin).length;
  if (how === 'button') await user.click(main().getByRole('button', { name: t('editor.save') }));
  else fireEvent.keyDown(window, { key: 's', metaKey: true });
  await waitFor(() => expect(getToasts().at(-1)?.message).toBe(t('editor.fixOne')));
  expect(writesOf(admin)).toHaveLength(writes);
  expect(await main().findByRole('region', { name: t('editor.anyway.title') })).toBeInTheDocument();
}

describe('Save anyway', () => {
  it('a draft with a validation issue: Save is refused, Save anyway asks (naming the problem and its tab) and sends the draft unchanged', async () => {
    const { user, admin } = await openRoute();
    await user.keyboard('e');
    await setUri(user, '/strict');
    // Nothing is offered before a Save was refused.
    expect(offer()).toBeNull();
    await refusedWithOffer(user, admin);
    expect(offer()).toHaveTextContent(t('editor.anyway.bodyOne', { kind: 'Route' }));
    // The action sits beside Save in the sticky header (in view however far down the refused field
    // is), described by the notice above the tabs.
    expect(anywayButton().closest('header')).toContainElement(main().getByRole('button', { name: t('editor.save') }));
    expect(anywayButton()).toHaveAccessibleDescription(t('editor.anyway.bodyOne', { kind: 'Route' }));

    await user.click(anywayButton());
    const dialog = await screen.findByRole('alertdialog', { name: t('editor.anyway.confirmTitle') });
    expect(dialog).toHaveTextContent(t('editor.anyway.confirmBodyOne'));
    expect(within(dialog).getAllByRole('listitem').map((li) => li.textContent)).toEqual([t('editor.anyway.itemAt', { tab: 'General', path: 'uri', message: STRICT })]);
    expect(writesOf(admin)).toEqual([]);

    await user.click(within(dialog).getByRole('button', { name: t('editor.anyway.confirm') }));
    await waitFor(() => expect(writesOf(admin)).toEqual([{ method: 'PUT', path: 'routes/r1', body: { ...stripTimestamps(ROUTE), uri: '/strict' } }]));
    // Then as after any save: locked, the stored value shown, no offer.
    expect(await main().findByRole('button', { name: t('editor.edit') })).toBeInTheDocument();
    expect(getToasts().at(-1)?.message).toBe(t('editor.saved', { name: 'web' }));
    expect(offer()).toBeNull();
  });

  it('Cancel sends nothing; the offer stays', async () => {
    const { user, admin } = await openRoute();
    await user.keyboard('e');
    await setUri(user, '/strict');
    await refusedWithOffer(user, admin);
    await user.click(anywayButton());
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: t('ui.cancel') }));
    await waitFor(() => expect(confirmDialog()).toBeNull());
    expect(writesOf(admin)).toEqual([]);
    expect(offer()).toBeInTheDocument();
  });

  it('Cmd/Ctrl-S refused for a validation issue offers it too', async () => {
    const { user, admin } = await openRoute();
    await user.keyboard('e');
    await setUri(user, '/strict');
    await refusedWithOffer(user, admin, 'keys');
  });

  it('asked once per editing session: not again after a tab switch or a save APISIX refuses late; again after a save ends the session', async () => {
    let refuse = true;
    const late = () => new Promise<Response>((done) => setTimeout(() => done(json(400, { error_msg: 'invalid configuration: property "uri" refused by APISIX' })), 40));
    const { user, admin } = await openRoute({ replies: { 'routes/r1': (req) => (req.method === 'PUT' && refuse ? late() : undefined) } });
    await user.keyboard('e');
    await setUri(user, '/strict');
    await refusedWithOffer(user, admin);
    await user.click(anywayButton());
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: t('editor.anyway.confirm') }));
    // APISIX's refusal shows as usual, and the local issue is still listed beside its field.
    expect(await main().findByText('invalid configuration: property "uri" refused by APISIX')).toBeInTheDocument();
    expect(writesOf(admin)).toHaveLength(1);
    expect(main().getByRole('textbox', { name: 'URI' })).toHaveAccessibleDescription(expect.stringContaining(STRICT) as string);
    expect(offer()).toBeInTheDocument();

    // A remount of the tab inside the session (JSON and back): still not asked again.
    await user.click(main().getByRole('tab', { name: /^JSON/ }));
    await jsonEditor('Route');
    await user.click(main().getByRole('tab', { name: /^General/ }));
    refuse = false;
    await user.click(anywayButton());
    expect(confirmDialog()).toBeNull();
    await waitFor(() => expect(writesOf(admin)).toHaveLength(2));
    expect(writesOf(admin)[1]).toEqual({ method: 'PUT', path: 'routes/r1', body: { ...stripTimestamps(ROUTE), uri: '/strict' } });
    expect(await main().findByRole('button', { name: t('editor.edit') })).toBeInTheDocument();

    // A new editing session asks again.
    await user.keyboard('e');
    await setUri(user, '/strict-again');
    await refusedWithOffer(user, admin);
    await user.click(anywayButton());
    expect(await screen.findByRole('alertdialog', { name: t('editor.anyway.confirmTitle') })).toBeInTheDocument();
  });

  it('a background refresh while locked does not carry a confirmation into the next session', async () => {
    undo.push(overrideDef('routes', { tabs: [GENERAL_TAB], validate: strict }));
    const user = userEvent.setup();
    const { admin, queryClient } = renderWithProviders(<EditorPage kind="routes" id="r1" />, { path: '/routes/r1', counts: {}, objects: { routes: [ROUTE] } });
    await screen.findByRole('heading', { level: 1, name: 'web' });
    await user.keyboard('e');
    await setUri(user, '/strict');
    await user.click(screen.getByRole('button', { name: t('editor.save') }));
    await user.click(await screen.findByRole('button', { name: t('editor.anyway.action') }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: t('editor.anyway.confirm') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(await screen.findByRole('button', { name: t('editor.edit') })).toBeInTheDocument();
    admin.touch('routes', 'r1', { uri: '/strict-theirs' });
    await queryClient.invalidateQueries();
    expect(await screen.findByText('/strict-theirs')).toBeInTheDocument();
    // Locked: nothing offered. Editing again: asked again.
    expect(screen.queryByRole('region', { name: t('editor.anyway.title') })).toBeNull();
    await user.keyboard('e');
    await user.click(screen.getByRole('button', { name: t('editor.save') }));
    await user.click(await screen.findByRole('button', { name: t('editor.anyway.action') }));
    expect(await screen.findByRole('alertdialog', { name: t('editor.anyway.confirmTitle') })).toBeInTheDocument();
  });

  it('never while a field holds input: not offered, and gone when one starts to hold', async () => {
    const { user, admin } = await openRoute({}, [GENERAL_TAB, HOLDER_TAB]);
    await user.keyboard('e');
    await setUri(user, '/strict');
    await refusedWithOffer(user, admin);
    await user.click(main().getByRole('tab', { name: /^Holder/ }));
    await user.type(main().getByRole('textbox', { name: 'holder' }), 'hold');
    await waitFor(() => expect(offer()).toBeNull());
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => expect(getToasts().at(-1)?.message).toBe(t('editor.fixHeld', { fix: t('editor.fixMany', { count: 2 }), message: 'Holder: not taken yet' })));
    expect(offer()).toBeNull();
    expect(writesOf(admin)).toEqual([]);
  });

  it('a new object: Create anyway is a POST of the draft as it is', async () => {
    undo.push(overrideDef('routes', { tabs: [GENERAL_TAB], validate: strict }));
    const { user, admin } = await openEditor('#/routes/new?upstream_id=u1', { objects: { routes: [], upstreams: [{ id: 'u1', name: 'pool', type: 'roundrobin', nodes: [] }] } });
    await setUri(user, '/strict');
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await user.click(await main().findByRole('button', { name: t('editor.anyway.action') }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: t('editor.anyway.confirm') }));
    await waitFor(() => expect(writesOf(admin)).toEqual([{ method: 'POST', path: 'routes', body: { uri: '/strict', status: 1, upstream_id: 'u1' } }]));
  });

  it("not for the frame's own refusals: a changed id", async () => {
    const { user, admin } = await openRoute();
    await user.keyboard('e');
    await setUri(user, '/strict');
    await user.click(main().getByRole('tab', { name: /^JSON/ }));
    const box = await jsonEditor('Route');
    await user.click(box);
    await user.keyboard('{Control>}a{/Control}');
    await user.paste(JSON.stringify({ ...stripTimestamps(ROUTE), id: 'r2', uri: '/strict' }));
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await waitFor(() => expect(getToasts().at(-1)?.message).toBe(t('editor.fixMany', { count: 2 })));
    expect(offer()).toBeNull();
    expect(writesOf(admin)).toEqual([]);
  });

  it("not for the frame's own refusals: a required id missing", async () => {
    undo.push(overrideDef('global_rules', { validate: () => [{ path: 'plugins', message: STRICT }] }));
    const { user, admin } = await openEditor('#/global_rules/new', { objects: { global_rules: [] } });
    await user.click(await main().findByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(getToasts().at(-1)?.message).toBe(t('editor.fixMany', { count: 2 })));
    expect(offer()).toBeNull();
    expect(writesOf(admin)).toEqual([]);
  });

  it('a conflict found by Save anyway: Overwrite goes on anyway', async () => {
    const { user, admin } = await openRoute();
    await user.keyboard('e');
    await setUri(user, '/strict');
    await refusedWithOffer(user, admin);
    admin.touch('routes', 'r1', { name: 'theirs' });
    await user.click(anywayButton());
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: t('editor.anyway.confirm') }));
    const conflict = await screen.findByRole('dialog', { name: t('editor.conflict.title', { kind: 'Route', name: 'web' }) });
    expect(writesOf(admin)).toEqual([]);
    await user.click(within(conflict).getByRole('button', { name: t('editor.conflict.overwrite') }));
    await waitFor(() => expect(writesOf(admin)).toEqual([{ method: 'PUT', path: 'routes/r1', body: { ...stripTimestamps(ROUTE), uri: '/strict' } }]));
  });

  it('a real disagreement: a plugin field holding a $env:// reference, which APISIX does not check (secret.lua 268–280) but the schema pattern refuses', async () => {
    const stored = { ...ROUTE, plugins: { 'proxy-rewrite': { host: 'upstream.test' } } };
    const { user, admin } = await openEditor('#/routes/r1?tab=json', { objects: { routes: [stored] }, replies: pluginReplies() });
    await main().findByRole('heading', { level: 1, name: 'web' });
    await user.keyboard('e');
    const box = await jsonEditor('Route');
    await user.click(box);
    await user.keyboard('{Control>}a{/Control}');
    const draft = { ...stripTimestamps(stored), plugins: { 'proxy-rewrite': { host: '$env://APISEVEN_UPSTREAM_HOST' } } };
    await user.paste(JSON.stringify(draft));
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await waitFor(() => expect(getToasts().at(-1)?.message).toBe(t('editor.fixOne')));
    await user.click(await main().findByRole('button', { name: t('editor.anyway.action') }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByRole('listitem').textContent).toMatch(/^Plugins, plugins\.proxy-rewrite\.host: must match pattern/);
    await user.click(within(dialog).getByRole('button', { name: t('editor.anyway.confirm') }));
    await waitFor(() => expect(writesOf(admin)).toEqual([{ method: 'PUT', path: 'routes/r1', body: draft }]));
  });
});
