// The pending-input guard in the editor frame: a field holding input that is not in the draft
// (usePending) blocks Save, badges its tab, counts as unsaved, and is not dropped by a tab switch
// without asking.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Obj } from '../api/types';
import { resetReadOnlyKeys } from '../api/write';
import { t } from '../i18n';
import type { TabDef } from '../resources/registry';
import { resetApp } from '../test/app';
import { GENERAL_TAB, main, openEditor, overrideDef, writesOf } from '../test/editor';
import { usePending } from '../ui';
import { getToasts } from '../ui/toast';

const undo: (() => void)[] = [];
afterEach(() => {
  for (const u of undo.splice(0)) u();
  resetApp();
  resetReadOnlyKeys();
});

/** A field that keeps what is typed to itself (never in the draft) and says so through usePending. */
function HoldingField() {
  const [text, setText] = useState('');
  usePending(text === '' ? undefined : `Held: "${text}" is not in the draft`);
  return <input aria-label="held" aria-invalid={text !== '' || undefined} value={text} onChange={(e) => setText(e.target.value)} />;
}

const HOLD_TAB: TabDef = { id: 'hold', label: 'Hold', fields: [], render: () => <HoldingField /> };
const ROUTE: Obj = { id: 'r1', name: 'web', uri: '/a', upstream: { type: 'roundrobin', nodes: [{ host: '10.0.0.1', port: 80, weight: 1 }] } };
const tab = (name: RegExp) => main().getByRole('tab', { name });
const button = (name: string) => main().getByRole('button', { name });

async function holding() {
  undo.push(overrideDef('routes', { tabs: [HOLD_TAB, GENERAL_TAB] }));
  const app = await openEditor('#/routes/r1', { objects: { routes: [ROUTE] } });
  await main().findByRole('heading', { level: 1, name: 'web' });
  await app.user.keyboard('e');
  await app.user.type(main().getByRole('textbox', { name: 'held' }), 'x');
  return app;
}

describe('pending input', () => {
  it('blocks Save from the button: no request, a toast, the tab badged, focus on the field', async () => {
    const { user, admin } = await holding();
    expect(tab(/^Hold/)).toHaveAccessibleName(`Hold ${t('ui.tabs.errors', { count: 1 })}`);
    await user.click(button(t('editor.save')));
    expect(getToasts().at(-1)?.message).toBe(t('editor.fixOne'));
    expect(writesOf(admin)).toEqual([]);
    expect(tab(/^Hold/)).toHaveAttribute('aria-selected', 'true');
    expect(main().getByRole('textbox', { name: 'held' })).toHaveFocus();
  });

  it('blocks Cmd/Ctrl-S the same way', async () => {
    const { admin } = await holding();
    fireEvent.keyDown(main().getByRole('textbox', { name: 'held' }), { key: 's', ctrlKey: true });
    await waitFor(() => expect(getToasts().at(-1)?.message).toBe(t('editor.fixOne')));
    await new Promise((r) => setTimeout(r, 20));
    expect(writesOf(admin)).toEqual([]);
    expect(main().getByRole('textbox', { name: 'held' })).toHaveValue('x');
  });

  it('counts as unsaved: Discard asks, and so does leaving the page', async () => {
    const { user } = await holding();
    expect(main().getByText(t('editor.unsaved'))).toBeInTheDocument();
    await user.click(button(t('editor.discard')));
    expect(await screen.findByRole('alertdialog', { name: t('editor.leave.title') })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('ui.cancel') }));
    await user.click(screen.getByRole('link', { name: /^Upstreams/ }));
    expect(await screen.findByRole('alertdialog', { name: t('editor.leave.title') })).toBeInTheDocument();
  });

  it('asks before a tab switch drops it: Stay keeps the text, Discard and switch switches', async () => {
    const { user, admin } = await holding();
    await user.click(tab(/^General/));
    const dialog = await screen.findByRole('alertdialog', { name: t('editor.pending.title') });
    expect(within(dialog).getByText('Held: "x" is not in the draft')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: t('editor.pending.stay') }));
    expect(tab(/^Hold/)).toHaveAttribute('aria-selected', 'true');
    expect(main().getByRole('textbox', { name: 'held' })).toHaveValue('x');

    await user.click(tab(/^General/));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: t('editor.pending.discard') }));
    expect(tab(/^General/)).toHaveAttribute('aria-selected', 'true');
    expect(tab(/^Hold/)).toHaveAccessibleName('Hold');
    // Nothing is pending any more: Save goes through (nothing changed, so it just locks).
    await user.click(button(t('editor.save')));
    expect(await main().findByRole('button', { name: t('editor.edit') })).toBeInTheDocument();
    expect(writesOf(admin)).toEqual([]);
  });
});
