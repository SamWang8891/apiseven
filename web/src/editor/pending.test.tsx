// The pending-input guard in the editor frame: a field holding input that is not in the draft
// (usePending) blocks Save, badges its tab, counts as unsaved, and is not dropped by a tab switch
// without asking.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { Link } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import type { Obj } from '../api/types';
import { resetReadOnlyKeys } from '../api/write';
import { t } from '../i18n';
import type { TabDef } from '../resources/registry';
import { resetApp } from '../test/app';
import { GENERAL_TAB, main, openEditor, overrideDef, writesOf } from '../test/editor';
import { Section } from '../resources/Section';
import { SchemaForm } from '../schema-form/SchemaForm';
import { Input, NumberInput, TagInput, usePending } from '../ui';
import { getToasts } from '../ui/toast';
import { newPathFor } from '../router/paths';

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

/** Renders of the hold tab's own content (not of the field holding input). */
let tabRenders = 0;
function RenderCount() {
  tabRenders += 1;
  return null;
}

const HOLD_TAB: TabDef = {
  id: 'hold',
  label: 'Hold',
  fields: [],
  render: () => (
    <>
      <HoldingField />
      <RenderCount />
      <Link to="?tab=general">Go to General</Link>
      <Link to={newPathFor('routes')}>New route</Link>
    </>
  ),
};
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
    expect(getToasts().at(-1)?.message).toBe(t('editor.fixHeld', { fix: t('editor.fixOne'), message: 'Held: "x" is not in the draft' }));
    expect(writesOf(admin)).toEqual([]);
    expect(tab(/^Hold/)).toHaveAttribute('aria-selected', 'true');
    expect(main().getByRole('textbox', { name: 'held' })).toHaveFocus();
  });

  it('blocks Cmd/Ctrl-S the same way', async () => {
    const { admin } = await holding();
    fireEvent.keyDown(main().getByRole('textbox', { name: 'held' }), { key: 's', ctrlKey: true });
    await waitFor(() => expect(getToasts().at(-1)?.message).toBe(t('editor.fixHeld', { fix: t('editor.fixOne'), message: 'Held: "x" is not in the draft' })));
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
    // Task 16b item 140: focus comes back to the tab strip, on the tab that stayed (the clicked one would switch on focus).
    await waitFor(() => expect(tab(/^Hold/)).toHaveFocus());
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

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

// Task 16b item 33: a field flagged by a validation problem above the held one does not take its focus.
describe('a refusal focuses the field that holds input', () => {
  const ISSUE_ABOVE: TabDef = {
    id: 'hold',
    label: 'Hold',
    fields: [],
    render: () => (
      <>
        <Input label="Flagged" error="Something is wrong here" value="v" onChange={() => {}} />
        <Section title="Part" defaultOpen>
          <Input label="Flagged inside" error="Wrong too" value="v" onChange={() => {}} />
          <HoldingField />
        </Section>
      </>
    ),
  };

  async function open() {
    undo.push(overrideDef('routes', { tabs: [ISSUE_ABOVE, GENERAL_TAB] }));
    const app = await openEditor('#/routes/r1', { objects: { routes: [ROUTE] } });
    await main().findByRole('heading', { level: 1, name: 'web' });
    await app.user.keyboard('e');
    await app.user.type(await main().findByRole('textbox', { name: 'held' }), 'x');
    return app;
  }

  it('a refused Save, from the button and from Cmd/Ctrl-S', async () => {
    const { user } = await open();
    await user.click(button(t('editor.save')));
    expect(getToasts().at(-1)?.message).toBe(t('editor.fixHeld', { fix: t('editor.fixOne'), message: 'Held: "x" is not in the draft' }));
    expect(main().getByRole('textbox', { name: 'held' })).toHaveFocus();
    main().getByRole('textbox', { name: /^Flagged$/ }).focus();
    fireEvent.keyDown(main().getByRole('textbox', { name: /^Flagged$/ }), { key: 's', ctrlKey: true });
    await waitFor(() => expect(main().getByRole('textbox', { name: 'held' })).toHaveFocus());
  });

  it('a refused collapse', async () => {
    const { user } = await open();
    await user.click(main().getByRole('button', { name: 'Part' }));
    expect(main().getByRole('button', { name: 'Part' })).toHaveAttribute('aria-expanded', 'true');
    expect(main().getByRole('textbox', { name: 'held' })).toHaveFocus();
  });
});

// Fix round 1, F6: the field typed in when a hold's message last changed may not be the one that holds.
describe('a refusal never focuses a field that holds nothing', () => {
  const LIMITS: TabDef = {
    id: 'limits',
    label: 'Limits',
    fields: ['limits'],
    render: ({ draft, setDraft }) => (
      <SchemaForm
        name="limits"
        schema={{ type: 'object', properties: { limits: { type: 'object', additionalProperties: { type: 'integer' } } } }}
        value={{ limits: draft.limits }}
        onChange={(v) => setDraft({ ...draft, limits: (v as Obj | undefined)?.limits })}
      />
    ),
  };

  it("a map row without a key, then a rename of another row's key: a refused Save focuses the row without a key", async () => {
    undo.push(overrideDef('routes', { tabs: [LIMITS, GENERAL_TAB] }));
    const { user } = await openEditor('#/routes/r1', { objects: { routes: [{ ...ROUTE, limits: { a: 1, b: 2 } }] } });
    await main().findByRole('heading', { level: 1, name: 'web' });
    await user.keyboard('e');
    await user.click(await main().findByRole('button', { name: t('sf.map.add') }));
    await user.type(main().getByRole('spinbutton', { name: t('sf.map.valueOfEntry', { n: 3 }) }), '7');
    const key1 = main().getByRole('textbox', { name: t('sf.map.keyOf', { n: 1 }) });
    await user.clear(key1);
    await user.type(key1, 'c');
    await user.tab();
    await user.click(button(t('editor.save')));
    expect(main().getByRole('textbox', { name: t('sf.map.keyOf', { n: 3 }) })).toHaveFocus();
  });
});

describe('pending input and the URL', () => {
  it('a link that changes only ?tab= asks first; Stay keeps the URL and the text, Discard switches', async () => {
    const { user } = await holding();
    await user.click(main().getByRole('link', { name: 'Go to General' }));
    const dialog = await screen.findByRole('alertdialog', { name: t('editor.pending.title') });
    expect(within(dialog).getByText('Held: "x" is not in the draft')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: t('editor.pending.stay') }));
    expect(tab(/^Hold/)).toHaveAttribute('aria-selected', 'true');
    expect(main().getByRole('textbox', { name: 'held' })).toHaveValue('x');
    expect(window.location.hash).not.toContain('tab=general');

    await user.click(main().getByRole('link', { name: 'Go to General' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: t('editor.pending.discard') }));
    await waitFor(() => expect(tab(/^General/)).toHaveAttribute('aria-selected', 'true'));
    expect(window.location.hash).toContain('tab=general');
  });

  it('Back across ?tab= asks first; Stay keeps the URL on the current tab, Discard goes back', async () => {
    const LINK_TAB: TabDef = { id: 'links', label: 'Links', fields: [], render: () => <Link to="?tab=hold">Go to Hold</Link> };
    undo.push(overrideDef('routes', { tabs: [HOLD_TAB, LINK_TAB] }));
    const { user } = await openEditor('#/routes/r1?tab=links', { objects: { routes: [ROUTE] } });
    await main().findByRole('heading', { level: 1, name: 'web' });
    await user.keyboard('e');
    // A history entry for the Hold tab, pushed as a link does.
    await user.click(main().getByRole('link', { name: 'Go to Hold' }));
    await user.type(await main().findByRole('textbox', { name: 'held' }), 'y');
    expect(window.location.hash).toBe('#/routes/r1?tab=hold');

    act(() => window.history.back());
    const dialog = await screen.findByRole('alertdialog', { name: t('editor.pending.title') });
    expect(within(dialog).getByText('Held: "y" is not in the draft')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: t('editor.pending.stay') }));
    await waitFor(() => expect(window.location.hash).toBe('#/routes/r1?tab=hold'));
    expect(tab(/^Hold/)).toHaveAttribute('aria-selected', 'true');
    expect(main().getByRole('textbox', { name: 'held' })).toHaveValue('y');

    act(() => window.history.back());
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: t('editor.pending.discard') }));
    await waitFor(() => expect(window.location.hash).toBe('#/routes/r1?tab=links'));
    await waitFor(() => expect(tab(/^Links/)).toHaveAttribute('aria-selected', 'true'));
  });

  it('a change of ?from= (a different copy) is leaving the page: unsaved work asks', async () => {
    undo.push(overrideDef('routes', { tabs: [GENERAL_TAB, HOLD_TAB] }));
    const { user } = await openEditor(`#${newPathFor('routes')}?from=r1`, { objects: { routes: [ROUTE] } });
    await main().findByRole('textbox', { name: 'Name' });
    await user.type(main().getByRole('textbox', { name: 'URI' }), '2');
    await user.click(tab(/^Hold/));
    await user.click(main().getByRole('link', { name: 'New route' }));
    expect(await screen.findByRole('alertdialog', { name: t('editor.leave.title') })).toBeInTheDocument();
  });
});

describe('pending input and the editor around it', () => {
  it('registering and unregistering does not re-render the tab content', async () => {
    const { user } = await holding();
    const before = tabRenders;
    await user.type(main().getByRole('textbox', { name: 'held' }), 'yz');
    await user.clear(main().getByRole('textbox', { name: 'held' }));
    expect(tab(/^Hold/)).toHaveAccessibleName('Hold');
    expect(tabRenders).toBe(before);
  });

  it('a tab click first lets the focused field commit: tag text typed without Enter is added, no question asked', async () => {
    function TagsTab({ draft, setDraft }: { draft: Obj; setDraft: (d: Obj) => void }) {
      const hosts = Array.isArray(draft.hosts) ? (draft.hosts as string[]) : [];
      return <TagInput label="Hosts" value={hosts} onChange={(next) => setDraft({ ...draft, hosts: next })} />;
    }
    undo.push(overrideDef('routes', { tabs: [{ id: 'tags', label: 'Tags', fields: ['hosts'], render: (p) => <TagsTab {...p} /> }, GENERAL_TAB] }));
    const { user, admin } = await openEditor('#/routes/r1', { objects: { routes: [ROUTE] } });
    await main().findByRole('heading', { level: 1, name: 'web' });
    await user.keyboard('e');
    await user.type(main().getByRole('textbox', { name: 'Hosts' }), 'a.example.org');
    await user.click(tab(/^General/));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(tab(/^General/)).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body?.hosts).toEqual(['a.example.org']);
  });

  it('a tab click with refused tag text still in the box asks, naming it; Stay keeps the text', async () => {
    function TagsTab({ draft, setDraft }: { draft: Obj; setDraft: (d: Obj) => void }) {
      const hosts = Array.isArray(draft.hosts) ? (draft.hosts as string[]) : [];
      return <TagInput label="Hosts" value={hosts} validate={(tag) => (/^[a-z.]+$/.test(tag) ? undefined : 'Not a host')} onChange={(next) => setDraft({ ...draft, hosts: next })} />;
    }
    undo.push(overrideDef('routes', { tabs: [GENERAL_TAB, { id: 'tags', label: 'Tags', fields: ['hosts'], render: (p) => <TagsTab {...p} /> }] }));
    const { user } = await openEditor('#/routes/r1?tab=tags', { objects: { routes: [ROUTE] } });
    await main().findByRole('heading', { level: 1, name: 'web' });
    await user.keyboard('e');
    await user.type(main().getByRole('textbox', { name: 'Hosts' }), 'bad host!');
    await user.click(tab(/^General/));
    const dialog = await screen.findByRole('alertdialog', { name: t('editor.pending.title') });
    expect(within(dialog).getByRole('listitem')).toHaveTextContent(t('ui.pending.tag', { field: 'Hosts', text: 'bad host!', reason: 'Not a host' }));
    await user.click(within(dialog).getByRole('button', { name: t('editor.pending.stay') }));
    expect(tab(/^Tags/)).toHaveAttribute('aria-selected', 'true');
    expect(main().getByRole('textbox', { name: 'Hosts' })).toHaveValue('bad host!');
  });

  it('typing in a field whose hold comes and goes keeps focus and caret', async () => {
    function PortTab({ draft, setDraft }: { draft: Obj; setDraft: (d: Obj) => void }) {
      const port = typeof draft.priority === 'number' ? draft.priority : undefined;
      return <NumberInput label="Priority" value={port} onChange={(v) => setDraft({ ...draft, priority: v })} />;
    }
    undo.push(overrideDef('routes', { tabs: [{ id: 'num', label: 'Num', fields: ['priority'], render: (p) => <PortTab {...p} /> }] }));
    const { user } = await openEditor('#/routes/r1', { objects: { routes: [{ ...ROUTE, priority: 10 }] } });
    await main().findByRole('heading', { level: 1, name: 'web' });
    await user.keyboard('e');
    const input = main().getByRole<HTMLInputElement>('spinbutton', { name: 'Priority' });
    await user.click(input);
    input.setSelectionRange(1, 1);
    await user.keyboard('x');
    expect(input).toHaveValue('1x0');
    await waitFor(() => expect(tab(/^Num/)).toHaveAccessibleName(`Num ${t('ui.tabs.errors', { count: 1 })}`));
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(2);
    await user.keyboard('{Backspace}');
    await waitFor(() => expect(tab(/^Num/)).toHaveAccessibleName(/^Num/));
    expect(tab(/^Num/)).not.toHaveAccessibleName(/to fix/);
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(1);
    expect(input).toHaveValue('10');
  });
});

describe('the JSON tab holds text that does not parse', () => {
  it('a tab switch asks: Stay keeps the text; Discard and switch shows the last valid draft, which Save sends', async () => {
    undo.push(overrideDef('routes', { tabs: [GENERAL_TAB] }));
    const { user, admin } = await openEditor('#/routes/r1?tab=json', { objects: { routes: [ROUTE] } });
    await main().findByRole('heading', { level: 1, name: 'web' });
    await user.keyboard('e');
    const editor = await screen.findByRole('textbox', { name: t('editor.json.label', { kind: 'Route' }) });
    await user.click(editor);
    await user.keyboard('{Control>}a{/Control}');
    await user.paste(JSON.stringify({ ...ROUTE, uri: '/b' }));
    await user.keyboard('{Control>}{End}{/Control}x');
    expect(tab(/^JSON/)).toHaveAccessibleName(`JSON ${t('ui.tabs.errors', { count: 1 })}`);

    await user.click(tab(/^General/));
    const dialog = await screen.findByRole('alertdialog', { name: t('editor.pending.title') });
    expect(within(dialog).getByRole('listitem')).toHaveTextContent(t('ui.pending.json', { field: t('editor.json.tab') }));
    await user.click(within(dialog).getByRole('button', { name: t('editor.pending.stay') }));
    expect(tab(/^JSON/)).toHaveAttribute('aria-selected', 'true');
    expect(editor.textContent).toMatch(/}x$/);

    await user.click(tab(/^General/));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: t('editor.pending.discard') }));
    expect(await main().findByRole('textbox', { name: 'URI' })).toHaveValue('/b');
    await user.click(button(t('editor.save')));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body?.uri).toBe('/b');
  });
});

describe('the JSON tab: Save and the controls around it', () => {
  async function brokenJsonTab() {
    undo.push(overrideDef('routes', { tabs: [GENERAL_TAB], hasStatus: true }));
    const app = await openEditor('#/routes/r1?tab=json', { objects: { routes: [{ ...ROUTE, status: 1 }] } });
    await main().findByRole('heading', { level: 1, name: 'web' });
    await app.user.keyboard('e');
    const editor = await screen.findByRole('textbox', { name: t('editor.json.label', { kind: 'Route' }) });
    await app.user.click(editor);
    await app.user.keyboard('{Control>}{End}{/Control}x');
    return { ...app, editor };
  }
  const held = t('ui.pending.json', { field: t('editor.json.tab') });

  it('Ctrl-S with text that does not parse: no write, and the toast names the JSON', async () => {
    const { admin } = await brokenJsonTab();
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => expect(getToasts().at(-1)?.message).toBe(t('editor.fixHeld', { fix: t('editor.fixOne'), message: held })));
    await new Promise((r) => setTimeout(r, 20));
    expect(writesOf(admin)).toEqual([]);
  });

  it("the header's status switch is refused while the JSON holds text; fixed, the PUT is what the JSON shows", async () => {
    const { user, admin, editor } = await brokenJsonTab();
    const status = main().getByRole('switch', { name: t('table.status.toggle', { name: 'web' }) });
    await user.click(status);
    expect(status).toBeChecked();
    expect(getToasts().at(-1)?.message).toBe(t('ui.pending.refused', { message: held }));
    expect(editor.textContent).toMatch(/}x$/);
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(writesOf(admin)).toEqual([]);

    await user.click(editor);
    await user.keyboard('{Control>}a{/Control}');
    await user.paste(JSON.stringify({ ...ROUTE, status: 1, uri: '/fixed' }));
    await user.click(button(t('editor.save')));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body).toEqual({ ...ROUTE, status: 1, uri: '/fixed' });
  });
});

