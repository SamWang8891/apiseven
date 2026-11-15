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
import { SEED_CERT, SEED_KEY } from '../test/sslSeed';
import { renderWithProviders } from '../test/providers';
import { EditorPage } from '../pages/EditorPage';
import { usePending } from '../ui';
import { getToasts, toastsRaised } from '../ui/toast';

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
  // The toast names the way out as well (R5.1).
  await waitFor(() => expect(getToasts().at(-1)?.message).toBe(t('editor.fixAnyway', { fix: t('editor.fixOne') })));
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
    expect(offer()).toHaveTextContent(t('editor.anyway.bodyOne'));
    // The action sits beside Save in the sticky header (in view however far down the refused field
    // is), described by the notice above the tabs.
    expect(anywayButton().closest('header')).toContainElement(main().getByRole('button', { name: t('editor.save') }));
    expect(anywayButton()).toHaveAccessibleDescription(t('editor.anyway.bodyOne'));

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
    const held = t('editor.fixHeld', { fix: t('editor.fixMany', { count: 2 }), message: 'Holder: not taken yet' });
    // The button's refusal, then Cmd/Ctrl-S's: one more toast each, so each was refused on its own.
    const before = toastsRaised();
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await waitFor(() => expect(toastsRaised()).toBe(before + 1));
    expect(getToasts().at(-1)?.message).toBe(held);
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => expect(toastsRaised()).toBe(before + 2));
    expect(getToasts().at(-1)?.message).toBe(held);
    expect(offer()).toBeNull();
    expect(main().queryByRole('button', { name: t('editor.anyway.action') })).toBeNull();
    expect(writesOf(admin)).toEqual([]);
  });

  it('only a refusal on its grounds offers it: not when the issue comes back while typing, nor after a refusal for held input once the hold clears (fix round 1, R2)', async () => {
    const { user, admin } = await openRoute({}, [GENERAL_TAB, HOLDER_TAB]);
    await user.keyboard('e');
    await setUri(user, '/strict');
    await refusedWithOffer(user, admin);
    // The issue goes (the refusal is forgotten with it), then comes back while typing: no Save refused on it.
    await setUri(user, '/ok');
    expect(offer()).toBeNull();
    await setUri(user, '/strict-later');
    expect(offer()).toBeNull();
    expect(main().queryByRole('button', { name: t('editor.anyway.action') })).toBeNull();
    // A refusal for held input is not one on these grounds, even once the hold clears.
    await user.click(main().getByRole('tab', { name: /^Holder/ }));
    await user.type(main().getByRole('textbox', { name: 'holder' }), 'hold');
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await waitFor(() => expect(getToasts().at(-1)?.message).toBe(t('editor.fixHeld', { fix: t('editor.fixMany', { count: 2 }), message: 'Holder: not taken yet' })));
    await user.clear(main().getByRole('textbox', { name: 'holder' }));
    expect(offer()).toBeNull();
    // A Save refused on them now offers it.
    await refusedWithOffer(user, admin);
    expect(writesOf(admin)).toEqual([]);
  });

  it('the question never opens without a press: it closes when the offer goes, and is not open when the offer comes back (fix round 1, R3)', async () => {
    // A check that depends on another object: the issue stands while upstream u1 is named "strict".
    undo.push(overrideDef('routes', { tabs: [GENERAL_TAB], validate: (_d, env) => (env.ctx.upstreams.find((u) => u.id === 'u1')?.value.name === 'strict' ? [{ path: 'uri', message: STRICT }] : []) }));
    const user = userEvent.setup();
    const { admin, queryClient } = renderWithProviders(<EditorPage kind="routes" id="r1" />, { path: '/routes/r1', counts: {}, objects: { routes: [ROUTE], upstreams: [{ id: 'u1', name: 'strict', type: 'roundrobin', nodes: [] }] } });
    await screen.findByRole('heading', { level: 1, name: 'web' });
    await user.keyboard('e');
    await setUri(user, '/b');
    await user.click(screen.getByRole('button', { name: t('editor.save') }));
    await user.click(await screen.findByRole('button', { name: t('editor.anyway.action') }));
    expect(await screen.findByRole('alertdialog', { name: t('editor.anyway.confirmTitle') })).toBeInTheDocument();
    admin.touch('upstreams', 'u1', { name: 'ok' });
    await queryClient.invalidateQueries();
    await waitFor(() => expect(confirmDialog()).toBeNull());
    admin.touch('upstreams', 'u1', { name: 'strict' });
    await queryClient.invalidateQueries();
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'URI' })).toHaveAccessibleDescription(STRICT));
    expect(confirmDialog()).toBeNull();
    await user.click(screen.getByRole('button', { name: t('editor.save') }));
    expect(await screen.findByRole('button', { name: t('editor.anyway.action') })).toBeInTheDocument();
    expect(confirmDialog()).toBeNull();
    await user.click(screen.getByRole('button', { name: t('editor.anyway.action') }));
    expect(await screen.findByRole('alertdialog', { name: t('editor.anyway.confirmTitle') })).toBeInTheDocument();
    expect(writesOf(admin)).toEqual([]);
  });

  it('a stored SSL: Save anyway is the same PATCH of what changed', async () => {
    undo.push(overrideDef('ssls', { validate: (d) => (d.desc === 'strict' ? [{ path: 'desc', message: STRICT }] : []) }));
    const stored = { id: 's1', snis: ['a.test'], cert: SEED_CERT, key: SEED_KEY };
    const { user, admin } = await openEditor('#/ssls/s1?tab=general', { objects: { ssls: [stored], routes: [], services: [] } });
    await main().findByRole('heading', { level: 1 });
    await user.keyboard('e');
    await user.type(await main().findByRole('textbox', { name: t('ssl.general.desc') }), 'strict');
    await refusedWithOffer(user, admin);
    await user.click(anywayButton());
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: t('editor.anyway.confirm') }));
    await waitFor(() => expect(writesOf(admin)).toEqual([{ method: 'PATCH', path: 'ssls/s1', body: { desc: 'strict' } }]));
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

  /** The stored route with proxy-rewrite, opened on its JSON tab and unlocked, its text replaced by `draft`. */
  async function routeJson(draft: (stored: Obj) => Obj) {
    const stored = { ...ROUTE, plugins: { 'proxy-rewrite': { host: 'upstream.test' } } };
    const app = await openEditor('#/routes/r1?tab=json', { objects: { routes: [stored] }, replies: pluginReplies() });
    await main().findByRole('heading', { level: 1, name: 'web' });
    await app.user.keyboard('e');
    const box = await jsonEditor('Route');
    await app.user.click(box);
    await app.user.keyboard('{Control>}a{/Control}');
    const value = draft(stripTimestamps(stored));
    await app.user.paste(JSON.stringify(value));
    return { ...app, value };
  }

  it('a real disagreement no fix removes: PCRE\'s $ matches before a final newline (APISIX stores "upstream.test\\n"), JavaScript\'s does not', async () => {
    const { user, admin, value } = await routeJson((stored) => ({ ...stored, plugins: { 'proxy-rewrite': { host: 'upstream.test\n' } } }));
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await waitFor(() => expect(getToasts().at(-1)?.message).toBe(t('editor.fixAnyway', { fix: t('editor.fixOne') })));
    await user.click(await main().findByRole('button', { name: t('editor.anyway.action') }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByRole('listitem').textContent).toMatch(/^Plugins, plugins\.proxy-rewrite\.host: must match pattern/);
    await user.click(within(dialog).getByRole('button', { name: t('editor.anyway.confirm') }));
    await waitFor(() => expect(writesOf(admin)).toEqual([{ method: 'PUT', path: 'routes/r1', body: value }]));
  });

  it('a $env:// reference in proxy-rewrite\'s host, which APISIX does not check: a plain Save, no issue, nothing offered (fix round 1, R1)', async () => {
    const { user, admin, value } = await routeJson((stored) => ({ ...stored, plugins: { 'proxy-rewrite': { host: '$env://APISEVEN_UPSTREAM_HOST' } } }));
    // No problem on the Plugins tab (its name would carry the count).
    expect(main().getByRole('tab', { name: /^Plugins/ })).toHaveAccessibleName('Plugins');
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await waitFor(() => expect(writesOf(admin)).toEqual([{ method: 'PUT', path: 'routes/r1', body: value }]));
    expect(main().queryByRole('button', { name: t('editor.anyway.action') })).toBeNull();
  });
});
