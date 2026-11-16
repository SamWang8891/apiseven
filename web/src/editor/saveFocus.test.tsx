// Save pressed from the keyboard keeps focus (the kit Button is busy, not disabled, while it saves):
// on Save while the write is out, and still on Save after APISIX refuses it. jsdom applies no focus
// fixup, so what is pinned here is that Save is never disabled meanwhile; e2e checks the focus itself.
//
// Final wave I1: after any refused save, focus returns to where the user was: the field that had focus
// before the frame's blur (useSaveRequest) if it still exists, else the button that was pressed, else
// Save. jsdom keeps the blur the frame makes, so these assert document.activeElement directly.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Obj } from '../api/types';
import { resetReadOnlyKeys } from '../api/write';
import { t } from '../i18n';
import { resetApp } from '../test/app';
import { GENERAL_TAB, main, openEditor, overrideDef, writesOf } from '../test/editor';
import { json } from '../test/fakeAdmin';
import { pluginReplies } from '../test/plugins';
import type { TabDef, TabProps } from '../resources/registry';
import { issueAt } from './issues';

const undo: (() => void)[] = [];
afterEach(() => {
  for (const u of undo.splice(0)) u();
  resetApp();
  resetReadOnlyKeys();
});

const ROUTE: Obj = { id: 'r1', name: 'web', uri: '/a', upstream: { type: 'roundrobin', nodes: [{ host: '10.0.0.1', port: 80, weight: 1 }] } };
const REFUSED = 'refused by APISIX';
/** A local check stricter than APISIX, so Save anyway is offered: it refuses every URI under /strict. */
const strict = (d: Obj) => (typeof d.uri === 'string' && d.uri.startsWith('/strict') ? [{ path: 'uri', message: 'the local check refuses /strict' }] : []);

/** Route r1 open for editing, with APISIX answering every PUT with `reply` once `gate` opens. */
async function editing(reply: Parameters<typeof json>[1], gate: Promise<void> = Promise.resolve(), validate?: typeof strict) {
  undo.push(overrideDef('routes', { tabs: [GENERAL_TAB], ...(validate ? { validate } : {}) }));
  const app = await openEditor('#/routes/r1', {
    objects: { routes: [ROUTE] },
    replies: { 'routes/r1': (req) => (req.method === 'PUT' ? gate.then(() => json(400, reply)) : undefined) },
  });
  await main().findByRole('heading', { level: 1, name: 'web' });
  await app.user.keyboard('e');
  return app;
}

const saveButton = () => main().getByRole('button', { name: t('editor.save') });
const pressCtrlS = () => fireEvent.keyDown(window, { key: 's', ctrlKey: true });

describe('Save from the keyboard', () => {
  it('keeps focus on Save while the save is out (busy, not disabled; a second press sends nothing) and after APISIX refuses it', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    undo.push(overrideDef('routes', { tabs: [GENERAL_TAB] }));
    const { user, admin } = await openEditor('#/routes/r1', {
      objects: { routes: [ROUTE] },
      replies: { 'routes/r1': (req) => (req.method === 'PUT' ? gate.then(() => json(400, { error_msg: 'refused by APISIX' })) : undefined) },
    });
    await main().findByRole('heading', { level: 1, name: 'web' });
    await user.keyboard('e');
    const uri = await main().findByRole('textbox', { name: 'URI' });
    await user.clear(uri);
    await user.type(uri, '/b');
    const save = main().getByRole('button', { name: t('editor.save') });
    save.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(save).toHaveAttribute('aria-busy', 'true'));
    expect(save).toHaveAttribute('aria-disabled', 'true');
    expect(save).not.toBeDisabled();
    expect(save).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    release();
    expect(await within(screen.getByRole('main')).findByRole('alert')).toHaveTextContent('refused by APISIX');
    expect(save).not.toHaveAttribute('aria-busy');
    expect(save).not.toHaveAttribute('aria-disabled');
    expect(save).toHaveFocus();
    expect(writesOf(admin)).toHaveLength(1);
  });
});

describe('focus after a refused save (I1)', () => {
  it('Cmd/Ctrl-S from a field, refused by APISIX: focus is back in that field', async () => {
    const { user, admin } = await editing({ error_msg: REFUSED });
    const uri = await main().findByRole('textbox', { name: 'URI' });
    await user.clear(uri);
    await user.type(uri, '/b');
    expect(uri).toHaveFocus();
    pressCtrlS();
    expect(await within(screen.getByRole('main')).findByRole('alert')).toHaveTextContent(REFUSED);
    expect(writesOf(admin)).toHaveLength(1);
    await waitFor(() => expect(document.activeElement).toBe(main().getByRole('textbox', { name: 'URI' })));
    expect(main().getByRole('textbox', { name: 'URI' })).toHaveValue('/b');
  });

  it('a refusal that comes after the user moved on leaves focus where they went', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { user, admin } = await editing({ error_msg: REFUSED }, gate);
    const uri = await main().findByRole('textbox', { name: 'URI' });
    await user.clear(uri);
    await user.type(uri, '/b');
    pressCtrlS();
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    // While the save is out, the user goes on to the ⋯ menu's button.
    const more = main().getByRole('button', { name: t('editor.more') });
    more.focus();
    release();
    expect(await within(screen.getByRole('main')).findByRole('alert')).toHaveTextContent(REFUSED);
    await new Promise((r) => setTimeout(r, 50));
    expect(document.activeElement).toBe(more);
  });

  it('the field left is gone after the refusal (APISIX names a property on another tab): focus is on Save', async () => {
    const { user } = await editing({ error_msg: 'invalid configuration: property "upstream" validation failed: wrong type' });
    const uri = await main().findByRole('textbox', { name: 'URI' });
    await user.clear(uri);
    await user.type(uri, '/b');
    pressCtrlS();
    expect(await within(screen.getByRole('main')).findByRole('alert')).toHaveTextContent('validation failed');
    await waitFor(() => expect(main().getByRole('tab', { name: /^JSON/ })).toHaveAttribute('aria-selected', 'true'));
    await waitFor(() => expect(document.activeElement).toBe(saveButton()));
  });

  it('Save anyway, refused by APISIX: focus is on Save anyway', async () => {
    const { user, admin } = await editing({ error_msg: REFUSED }, Promise.resolve(), strict);
    const uri = await main().findByRole('textbox', { name: 'URI' });
    await user.clear(uri);
    await user.type(uri, '/strict');
    await user.click(saveButton());
    const anyway = await main().findByRole('button', { name: t('editor.anyway.action') });
    await user.click(anyway);
    const dialog = await screen.findByRole('alertdialog', { name: t('editor.anyway.confirmTitle') });
    await user.click(within(dialog).getByRole('button', { name: t('editor.anyway.confirm') }));
    expect(await within(screen.getByRole('main')).findByRole('alert')).toHaveTextContent(REFUSED);
    expect(writesOf(admin)).toHaveLength(1);
    await waitFor(() => expect(document.activeElement).toBe(main().getByRole('button', { name: t('editor.anyway.action') })));
  });

  it('while a save runs, Discard and Save anyway are unavailable (aria-disabled), never disabled, so neither loses focus', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { user } = await editing({ error_msg: REFUSED }, gate, strict);
    const uri = await main().findByRole('textbox', { name: 'URI' });
    await user.clear(uri);
    await user.type(uri, '/strict');
    await user.click(saveButton());
    const anyway = await main().findByRole('button', { name: t('editor.anyway.action') });
    await user.click(anyway);
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: t('editor.anyway.confirm') }));
    await waitFor(() => expect(saveButton()).toHaveAttribute('aria-busy', 'true'));
    const discard = main().getByRole('button', { name: t('editor.discard') });
    for (const button of [discard, main().getByRole('button', { name: t('editor.anyway.action') })]) {
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).not.toBeDisabled();
    }
    discard.focus();
    await user.keyboard('{Enter}');
    expect(discard).toHaveFocus();
    release();
    expect(await within(screen.getByRole('main')).findByRole('alert')).toHaveTextContent(REFUSED);
    // Discard pressed during the save did nothing: the draft is still there, and the page still editing.
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(main().getByRole('textbox', { name: 'URI' })).toHaveValue('/strict');
    expect(discard).not.toHaveAttribute('aria-disabled');
  });
});

// Last step, fix round 1, F1: a local refusal whose first problem is on another tab shows that tab; once
// it shows, its first flagged control has focus (never body).
function ExtraFields({ issues }: TabProps) {
  const problem = issueAt(issues, 'desc');
  return <input aria-label="Extra" aria-invalid={problem ? true : undefined} defaultValue="" />;
}
const EXTRA_TAB: TabDef = { id: 'extra', label: 'Extra', fields: ['desc'], render: (p) => <ExtraFields {...p} /> };
const needsDesc = (d: Obj) => (typeof d.desc === 'string' && d.desc !== '' ? [] : [{ path: 'desc', message: 'a description is needed' }]);

describe('a local refusal on another tab (F1)', () => {
  it('Cmd/Ctrl-S from a field, refused for a problem on another tab: that tab shows, and its flagged control has focus', async () => {
    undo.push(overrideDef('routes', { tabs: [GENERAL_TAB, EXTRA_TAB], validate: needsDesc }));
    const { user, admin } = await openEditor('#/routes/r1', { objects: { routes: [ROUTE] } });
    await main().findByRole('heading', { level: 1, name: 'web' });
    await user.keyboard('e');
    const uri = await main().findByRole('textbox', { name: 'URI' });
    await user.clear(uri);
    await user.type(uri, '/b');
    pressCtrlS();
    await waitFor(() => expect(main().getByRole('tab', { name: /^Extra/ })).toHaveAttribute('aria-selected', 'true'));
    await waitFor(() => expect(document.activeElement).toBe(main().getByRole('textbox', { name: 'Extra' })));
    expect(writesOf(admin)).toEqual([]);
  });

  it('on the real route editor: Cmd/Ctrl-S from Description with limit-count missing its count shows the Plugins tab and focuses a flagged control there, never body', async () => {
    const route: Obj = { ...ROUTE, plugins: { 'limit-count': { time_window: 60 } } };
    const { user, admin } = await openEditor('#/routes/r1', { objects: { routes: [route], upstreams: [] }, replies: pluginReplies() });
    await main().findByRole('heading', { level: 1, name: 'web' });
    await user.keyboard('e');
    const desc = await main().findByRole('textbox', { name: t('rt.general.desc') });
    await user.type(desc, 'x');
    pressCtrlS();
    await waitFor(() => expect(main().getByRole('tab', { name: new RegExp(`^${t('pl.tab')}`) })).toHaveAttribute('aria-selected', 'true'));
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-invalid')).toBe('true'));
    expect(writesOf(admin)).toEqual([]);
  });
});
