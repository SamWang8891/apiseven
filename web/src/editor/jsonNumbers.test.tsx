// Fix round 1, R2.1 (the D4 rule in JSON text): a number literal a double cannot hold exactly
// (9007199254740993) is held where it is typed, with a message naming it, never taken rounded: in the
// editor's JSON tab, a plugin card's JSON view and a schema-form JSON field. Digits inside a string
// are text, not a number.
import { screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Obj } from '../api/types';
import { resetReadOnlyKeys } from '../api/write';
import { t } from '../i18n';
import { resetApp } from '../test/app';
import { GENERAL_TAB, main, openEditor, overrideDef, writesOf } from '../test/editor';
import { renderPluginsTab } from '../test/plugins';
import { renderSchemaForm } from '../test/schemaForm';
import { inexactNumberIn } from '../ui/decimal';
import { getToasts } from '../ui/toast';

beforeAll(async () => {
  await import('../ui/codemirror/CodeEditorImpl');
});

const undo: (() => void)[] = [];
afterEach(() => {
  for (const u of undo.splice(0)) u();
  resetApp();
  resetReadOnlyKeys();
});

const BIG = '9007199254740993';

async function replace(user: UserEvent, box: HTMLElement, text: string) {
  await user.click(box);
  await user.keyboard('{Control>}a{/Control}');
  await user.paste(text);
}

describe('inexactNumberIn', () => {
  it('finds the first number token a double would round; digits in strings and keys are text', () => {
    expect(inexactNumberIn(`{"a": ${BIG}}`)).toBe(BIG);
    expect(inexactNumberIn(`{"a": [1, -${BIG}e0]}`)).toBe(`-${BIG}e0`);
    expect(inexactNumberIn('{"a": 0.1000000000000000055511151231257827}')).toBe('0.1000000000000000055511151231257827');
    expect(inexactNumberIn('{"a": 1e400}')).toBe('1e400');
    expect(inexactNumberIn(`{"${BIG}": "${BIG}", "b": "\\"${BIG}"}`)).toBeUndefined();
    expect(inexactNumberIn('{"a": 9007199254740992, "b": 1.5, "c": -0.0, "d": 1e21, "e": 2.50}')).toBeUndefined();
  });
});

describe('a number a double would round, typed as JSON', () => {
  it('the editor’s JSON tab: held with a message naming it, Save sends nothing; fixed, the exact number is sent', async () => {
    undo.push(overrideDef('routes', { tabs: [GENERAL_TAB] }));
    const ROUTE: Obj = { id: 'r1', name: 'web', uri: '/a', priority: 1, upstream: { type: 'roundrobin', nodes: [{ host: '10.0.0.1', port: 80, weight: 1 }] } };
    const { user, admin } = await openEditor('#/routes/r1?tab=json', { objects: { routes: [ROUTE] } });
    await main().findByRole('heading', { level: 1, name: 'web' });
    await user.keyboard('e');
    const box = await screen.findByRole('textbox', { name: t('editor.json.label', { kind: 'Route' }) });
    const text = (n: string) => JSON.stringify({ ...ROUTE, priority: '§' }).replace('"§"', n);
    await replace(user, box, text(BIG));
    expect(await main().findByText(t('json.inexact', { number: BIG }))).toBeInTheDocument();
    // Save is off while the tab holds text (as for text that doesn't parse); Cmd/Ctrl-S says why.
    expect(main().getByRole('button', { name: t('editor.save') })).toBeDisabled();
    await user.keyboard('{Control>}s{/Control}');
    expect(getToasts().at(-1)?.message).toBe(t('editor.fixHeld', { fix: t('editor.fixOne'), message: t('ui.pending.inexact', { field: t('editor.json.tab'), text: BIG }) }));
    expect(writesOf(admin)).toEqual([]);

    await replace(user, box, text('9007199254740991'));
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body).toMatchObject({ priority: 9007199254740991 });
  });

  it('a plugin card’s JSON view: held, the config unchanged', async () => {
    const harness = renderPluginsTab({ scope: 'route', value: { 'limit-count': { count: 1, time_window: 60 } } });
    await waitFor(() => expect(screen.queryByText(t('pl.loading'))).not.toBeInTheDocument());
    const card = screen.getByRole('group', { name: 'limit-count' });
    await harness.user.click(within(card).getByRole('button', { name: 'limit-count' }));
    await harness.user.click(within(card).getByRole('button', { name: t('pl.card.json') }));
    const box = await within(card).findByRole('textbox', { name: t('pl.card.jsonLabel', { name: 'limit-count' }) });
    await replace(harness.user, box, `{"count": ${BIG}, "time_window": 60}`);
    expect(harness.held()).toEqual([t('ui.pending.inexact', { field: 'limit-count', text: BIG })]);
    expect(within(card).getByText(t('json.inexact', { number: BIG }))).toBeInTheDocument();
    expect(harness.value()).toEqual({ 'limit-count': { count: 1, time_window: 60 } });
  });

  it('a schema-form JSON field: held, nothing emitted', async () => {
    const form = renderSchemaForm({ type: 'object', properties: { body_schema: { type: 'object' } } }, {});
    const box = await screen.findByRole('textbox', { name: t('sf.json.label', { key: 'body_schema' }) });
    await replace(form.user, box, `{"maximum": ${BIG}}`);
    expect(form.held()).toEqual([t('ui.pending.inexact', { field: 'body_schema', text: BIG })]);
    expect(screen.getByText(t('json.inexact', { number: BIG }))).toBeInTheDocument();
    expect(form.changes).not.toHaveBeenCalled();
  });
});
