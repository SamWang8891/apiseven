// The frame's extension points for kinds that need more than an ID field and a list table (Task 15):
// ResourceDef.NewId (a kind's own id control), idProblem (an id the kind can't take), createWhenMissing
// (a page that exists whether or not its object does) and ListComponent (a kind's own list page).
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { resetReadOnlyKeys } from '../api/write';
import { t } from '../i18n';
import type { NewIdProps, TabDef } from '../resources/registry';
import { resetApp } from '../test/app';
import { main, openEditor, overrideDef, writesOf } from '../test/editor';
import { getToasts } from '../ui/toast';
import { newPathFor } from '../router/paths';

const undo: (() => void)[] = [];
afterEach(() => {
  for (const step of undo.splice(0)) step();
  resetApp();
  resetReadOnlyKeys();
});

/** A NewId that takes "<a>-<b>" from two inputs, and starts the draft over when the first changes. */
function PairId({ value, onChange, setDraft, error }: NewIdProps) {
  const [a = '', b = ''] = value.split('-');
  return (
    <div>
      <input aria-label="first part" value={a} onChange={(e) => {
        onChange(`${e.target.value}-${b}`);
        setDraft({ started: e.target.value });
      }} />
      <input aria-label="second part" value={b} onChange={(e) => onChange(`${a}-${e.target.value}`)} />
      {error && <p role="note">{error}</p>}
    </div>
  );
}

/** A tab that shows the id the frame gives tabs. */
const ID_TAB: TabDef = { id: 'general', label: 'General', fields: ['started'], render: (p) => <p data-testid="tab-id">{p.id ?? '(none)'}</p> };

describe('ResourceDef.NewId', () => {
  it("replaces the frame's ID field; its id is created under, given to the tabs, and its draft change kept", async () => {
    undo.push(overrideDef('consumer_groups', { NewId: PairId, tabs: [ID_TAB], validate: () => [] }));
    const { user, admin } = await openEditor(`#${newPathFor('consumer_groups')}`, { objects: { consumer_groups: [] } });
    await main().findByRole('button', { name: t('editor.create') });
    expect(main().queryByRole('textbox', { name: /^ID/ })).not.toBeInTheDocument();
    await user.type(main().getByRole('textbox', { name: 'first part' }), 'a');
    await user.type(main().getByRole('textbox', { name: 'second part' }), 'b');
    expect(main().getByTestId('tab-id')).toHaveTextContent('a-b');
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    // The NewId replaced the draft ({ plugins: {} }, the blank) with its own when the first part changed.
    await waitFor(() => expect(writesOf(admin)).toEqual([{ method: 'PUT', path: 'consumer_groups/a-b', body: { started: 'a' } }]));
  });

  it("idProblem refuses an id the kind can't take: shown at the control, Save and Cmd/Ctrl-S send nothing, the toast names it", async () => {
    undo.push(overrideDef('consumer_groups', { NewId: PairId, tabs: [ID_TAB], validate: () => [], idProblem: (id) => (id.startsWith('x') ? `ID: "${id}" starts with x` : undefined) }));
    const { user, admin } = await openEditor(`#${newPathFor('consumer_groups')}`, { objects: { consumer_groups: [] } });
    await main().findByRole('button', { name: t('editor.create') });
    await user.type(main().getByRole('textbox', { name: 'first part' }), 'x');
    expect(main().getByRole('note')).toHaveTextContent('ID: "x-" starts with x');
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    expect(writesOf(admin)).toEqual([]);
    expect(getToasts().at(-1)?.message).toBe(t('editor.fixHeld', { fix: t('editor.fixOne'), message: 'ID: "x-" starts with x' }));
  });
});

describe('ResourceDef.createWhenMissing', () => {
  it('nothing stored under the id: the page opens unlocked as a new object under it, and Create PUTs there; then it is the stored one', async () => {
    undo.push(overrideDef('consumer_groups', { createWhenMissing: true, tabs: [ID_TAB], validate: () => [] }));
    const { user, admin } = await openEditor('#/consumer_groups/fresh', { objects: { consumer_groups: [] } });
    expect(await main().findByRole('heading', { level: 1, name: 'fresh' })).toBeInTheDocument();
    expect(main().getByTestId('tab-id')).toHaveTextContent('fresh');
    expect(main().queryByRole('textbox', { name: /^ID/ })).not.toBeInTheDocument();
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(writesOf(admin)).toEqual([{ method: 'PUT', path: 'consumer_groups/fresh', body: { plugins: {} } }]));
    expect(await main().findByRole('button', { name: t('editor.edit') })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/consumer_groups/fresh');
  });

  it('without it, the same page says not found', async () => {
    await openEditor('#/consumer_groups/fresh', { objects: { consumer_groups: [] } });
    expect(await main().findByRole('heading', { level: 1, name: t('editor.notFound.title', { kind: t('kind.consumer_groups.singular'), id: 'fresh' }) })).toBeInTheDocument();
  });
});

describe('ResourceDef.ListComponent', () => {
  it("the router renders a kind's own list page instead of the generic one", async () => {
    undo.push(overrideDef('protos', { ListComponent: ({ kind }) => <h1>{`own list of ${kind}`}</h1> }));
    await openEditor('#/protos', { objects: { protos: [{ id: 'p1', content: 'x' }] } });
    expect(await main().findByRole('heading', { level: 1, name: 'own list of protos' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
