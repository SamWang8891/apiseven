// Plugin cards and the pending-input guard: JSON that doesn't parse (the card's own JSON view, the
// `_meta` JSON values) is held for Save under the plugin's name, and a card never hides a field that
// holds input: collapsing the card or `_meta`, or switching Form/JSON, is refused while one does.
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { pluginReplies, renderPluginsTab } from '../test/plugins';
import { getToasts } from '../ui/toast';

const LIMIT = { 'limit-count': { count: 2, time_window: 60 } };

async function openCard(harness: ReturnType<typeof renderPluginsTab>, name: string) {
  const el = await screen.findByRole('group', { name });
  await waitFor(() => expect(screen.queryByText(t('pl.loading'))).not.toBeInTheDocument());
  await harness.user.click(within(el).getByRole('button', { name }));
  return el;
}

async function replaceCode(user: ReturnType<typeof renderPluginsTab>['user'], box: HTMLElement, text: string) {
  await user.click(box);
  await user.keyboard('{Control>}a{/Control}');
  await user.paste(text);
}

const lastToast = () => getToasts().at(-1)?.message;

// Task 16b item 54: a card opened before the plugin list loaded edits in JSON; the list arriving must not drop held text.
describe('a card opened while the plugin list loads', () => {
  it('JSON text held then stays in the JSON view when the form becomes available; parsed text can go to Form', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const harness = renderPluginsTab({
      scope: 'route',
      value: LIMIT,
      admin: {
        replies: {
          plugins: async (req) => {
            await gate;
            return pluginReplies().plugins?.(req) as Response;
          },
        },
      },
    });
    const el = await screen.findByRole('group', { name: 'limit-count' });
    await harness.user.click(within(el).getByRole('button', { name: 'limit-count' }));
    expect(within(el).getByText(t('pl.card.formLoading'))).toBeInTheDocument();
    const box = await within(el).findByRole('textbox', { name: t('pl.card.jsonLabel', { name: 'limit-count' }) });
    await replaceCode(harness.user, box, '{"count": 2,');
    expect(harness.held()).toEqual([t('ui.pending.json', { field: 'limit-count' })]);
    release();
    expect(await within(el).findByRole('button', { name: t('pl.card.json') })).toHaveAttribute('aria-pressed', 'true');
    expect(within(el).getByRole('textbox', { name: t('pl.card.jsonLabel', { name: 'limit-count' }) })).toHaveTextContent('{"count": 2,');
    expect(harness.held()).toEqual([t('ui.pending.json', { field: 'limit-count' })]);
    await replaceCode(harness.user, within(el).getByRole('textbox', { name: t('pl.card.jsonLabel', { name: 'limit-count' }) }), '{"count": 3, "time_window": 60}');
    await harness.user.click(within(el).getByRole('button', { name: t('pl.card.form') }));
    expect(within(el).getByRole('button', { name: t('pl.card.form') })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe("a card's JSON view", () => {
  async function brokenJson() {
    const harness = renderPluginsTab({ scope: 'route', value: LIMIT });
    const el = await openCard(harness, 'limit-count');
    await harness.user.click(within(el).getByRole('button', { name: t('pl.card.json') }));
    const box = await within(el).findByRole('textbox', { name: t('pl.card.jsonLabel', { name: 'limit-count' }) });
    await replaceCode(harness.user, box, '{"count": 2,');
    return { ...harness, el, box };
  }

  it('holds JSON that does not parse, or is not an object, under the plugin name', async () => {
    const { user, held, box } = await brokenJson();
    expect(held()).toEqual([t('ui.pending.json', { field: 'limit-count' })]);
    expect(box).toHaveAttribute('aria-invalid', 'true');
    await replaceCode(user, box, '[1]');
    expect(held()).toEqual([t('ui.pending.jsonType', { field: 'limit-count', type: 'object' })]);
    await replaceCode(user, box, '{"count": 3, "time_window": 60}');
    expect(held()).toEqual([]);
  });

  it('switching to Form is refused while the text does not parse: the text stays, and the toast says why', async () => {
    const { user, el, box, value } = await brokenJson();
    await user.click(within(el).getByRole('button', { name: t('pl.card.form') }));
    expect(lastToast()).toBe(t('ui.pending.refused', { message: t('ui.pending.json', { field: 'limit-count' }) }));
    expect(within(el).getByRole('button', { name: t('pl.card.json') })).toHaveAttribute('aria-pressed', 'true');
    expect(box.textContent).toBe('{"count": 2,');
    expect(box).toHaveFocus();
    expect(value()).toEqual(LIMIT);
  });

  it('collapsing the card is refused while the text does not parse', async () => {
    const { user, el, box, held } = await brokenJson();
    await user.click(within(el).getByRole('button', { name: 'limit-count' }));
    expect(within(el).getByRole('button', { name: 'limit-count' })).toHaveAttribute('aria-expanded', 'true');
    expect(box.textContent).toBe('{"count": 2,');
    expect(held()).toHaveLength(1);
    expect(lastToast()).toBe(t('ui.pending.refused', { message: t('ui.pending.json', { field: 'limit-count' }) }));
  });
});

describe("a card's form", () => {
  it('a field holding "-" keeps the card open and the view on Form', async () => {
    const harness = renderPluginsTab({ scope: 'route', value: LIMIT });
    const el = await openCard(harness, 'limit-count');
    const code = within(el).getByRole('spinbutton', { name: 'rejected_code' });
    await harness.user.type(code, '-');
    const message = t('ui.pending.notNumber', { field: 'limit-count.rejected_code', text: '-' });
    expect(harness.held()).toEqual([message]);
    await harness.user.click(within(el).getByRole('button', { name: t('pl.card.json') }));
    expect(within(el).getByRole('button', { name: t('pl.card.form') })).toHaveAttribute('aria-pressed', 'true');
    await harness.user.click(within(el).getByRole('button', { name: 'limit-count' }));
    expect(within(el).getByRole('button', { name: 'limit-count' })).toHaveAttribute('aria-expanded', 'true');
    expect(code).toHaveValue('-');
    expect(code).toHaveFocus();
    expect(lastToast()).toBe(t('ui.pending.refused', { message }));
    // Cleared, it holds nothing: the card closes.
    await harness.user.clear(code);
    await harness.user.click(within(el).getByRole('button', { name: 'limit-count' }));
    expect(within(el).getByRole('button', { name: 'limit-count' })).toHaveAttribute('aria-expanded', 'false');
    expect(harness.held()).toEqual([]);
  });
});

describe('_meta', () => {
  it('filter JSON that does not parse, or is not an array, is held; _meta and the card stay open', async () => {
    const harness = renderPluginsTab({ scope: 'route', value: LIMIT });
    const el = await openCard(harness, 'limit-count');
    const metaToggle = within(el).getByRole('button', { name: new RegExp(`^${t('pl.meta.title')}`) });
    await harness.user.click(metaToggle);
    const box = await within(el).findByRole('textbox', { name: t('pl.meta.filterLabel') });
    await replaceCode(harness.user, box, '[["arg_v", "==",');
    expect(harness.held()).toEqual([t('ui.pending.json', { field: 'limit-count._meta.filter' })]);
    await replaceCode(harness.user, box, '{"a": 1}');
    const message = t('ui.pending.problem', { field: 'limit-count._meta.filter', problem: t('pl.meta.filterNotArray') });
    expect(harness.held()).toEqual([message]);

    await harness.user.click(metaToggle);
    expect(metaToggle).toHaveAttribute('aria-expanded', 'true');
    expect(box.textContent).toBe('{"a": 1}');
    await harness.user.click(within(el).getByRole('button', { name: 'limit-count' }));
    expect(within(el).getByRole('button', { name: 'limit-count' })).toHaveAttribute('aria-expanded', 'true');
    expect(lastToast()).toBe(t('ui.pending.refused', { message }));
    expect(harness.value()).toEqual(LIMIT);
  });

  it('priority text that is not a number is held under the plugin name', async () => {
    const harness = renderPluginsTab({ scope: 'route', value: LIMIT });
    const el = await openCard(harness, 'limit-count');
    await harness.user.click(within(el).getByRole('button', { name: new RegExp(`^${t('pl.meta.title')}`) }));
    await harness.user.type(within(el).getByRole('spinbutton', { name: 'priority' }), '1e');
    expect(harness.held()).toEqual([t('ui.pending.notNumber', { field: 'limit-count._meta.priority', text: '1e' })]);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('error_response does not switch from JSON to Text while its JSON does not parse', async () => {
    const harness = renderPluginsTab({ scope: 'route', value: { 'key-auth': { _meta: { error_response: { message: 'Denied' } } } }, validate: false });
    const el = await openCard(harness, 'key-auth');
    await harness.user.click(within(el).getByRole('button', { name: new RegExp(`^${t('pl.meta.title')}`) }));
    const box = await within(el).findByRole('textbox', { name: t('pl.meta.errorJsonLabel') });
    await replaceCode(harness.user, box, '{"message": ');
    expect(harness.held()).toEqual([t('ui.pending.json', { field: 'key-auth._meta.error_response' })]);
    const kind = within(el).getByRole('combobox', { name: t('pl.meta.errorKind') });
    await harness.user.click(kind);
    await harness.user.click(screen.getByRole('option', { name: t('pl.meta.errorText') }));
    expect(kind).toHaveTextContent(t('pl.meta.errorJson'));
    expect(box.textContent).toBe('{"message": ');
    expect(harness.value()).toEqual({ 'key-auth': { _meta: { error_response: { message: 'Denied' } } } });
    expect(lastToast()).toBe(t('ui.pending.refused', { message: t('ui.pending.json', { field: 'key-auth._meta.error_response' }) }));
  });

  it("held filter text: the card's JSON view cannot change _meta meanwhile; fixed, the filter is saved and the JSON view editable again", async () => {
    const harness = renderPluginsTab({ scope: 'route', value: LIMIT });
    const el = await openCard(harness, 'limit-count');
    await harness.user.click(within(el).getByRole('button', { name: new RegExp(`^${t('pl.meta.title')}`) }));
    const filter = await within(el).findByRole('textbox', { name: t('pl.meta.filterLabel') });
    await replaceCode(harness.user, filter, '[["a", ');
    await harness.user.click(within(el).getByRole('button', { name: t('pl.card.json') }));
    const box = await within(el).findByRole('textbox', { name: t('pl.card.jsonLabel', { name: 'limit-count' }) });
    await replaceCode(harness.user, box, '{"count": 9, "time_window": 60, "_meta": {"filter": [["b", "==", "1"]]}}');
    expect(filter.textContent).toBe('[["a", ');
    expect(harness.value()).toEqual(LIMIT);
    await replaceCode(harness.user, filter, '[["c", "==", "2"]]');
    expect(harness.held()).toEqual([]);
    expect(harness.value()).toEqual({ 'limit-count': { ...LIMIT['limit-count'], _meta: { filter: [['c', '==', '2']] } } });
    expect(within(el).queryByText(t('pl.card.heldByMeta'))).not.toBeInTheDocument();
    await replaceCode(harness.user, box, '{"count": 9, "time_window": 60}');
    expect(harness.value()).toEqual({ 'limit-count': { count: 9, time_window: 60 } });
  });
});

describe('the JSON view and _meta never hide or overwrite each other while one holds input', () => {
  const metaToggle = (el: HTMLElement) => within(el).getByRole('button', { name: new RegExp(`^${t('pl.meta.title')}`) });
  const jsonBox = (el: HTMLElement) => within(el).findByRole('textbox', { name: t('pl.card.jsonLabel', { name: 'limit-count' }) });

  async function metaHolds(hold: (el: HTMLElement, user: ReturnType<typeof renderPluginsTab>['user']) => Promise<void>) {
    const harness = renderPluginsTab({ scope: 'route', value: LIMIT });
    const el = await openCard(harness, 'limit-count');
    await harness.user.click(metaToggle(el));
    await hold(el, harness.user);
    return { ...harness, el };
  }

  it('_meta filter held, then the JSON view: read-only (typing changes nothing); _meta does not collapse; the filter text stays', async () => {
    const { user, el, held, value } = await metaHolds(async (card, u) => replaceCode(u, await within(card).findByRole('textbox', { name: t('pl.meta.filterLabel') }), '[["a", '));
    const filterHeld = t('ui.pending.json', { field: 'limit-count._meta.filter' });
    expect(held()).toEqual([filterHeld]);
    await user.click(within(el).getByRole('button', { name: t('pl.card.json') }));
    expect(within(el).getByText(t('pl.card.heldByMeta'))).toBeInTheDocument();
    const box = await jsonBox(el);
    await replaceCode(user, box, '{"count": 2,');
    expect(box.textContent).not.toContain('{"count": 2,');
    expect(held()).toEqual([filterHeld]);
    await user.click(metaToggle(el));
    expect(metaToggle(el)).toHaveAttribute('aria-expanded', 'true');
    expect(within(el).getByRole('textbox', { name: t('pl.meta.filterLabel') }).textContent).toBe('[["a", ');
    expect(held()).toEqual([filterHeld]);
    expect(value()).toEqual(LIMIT);
  });

  it('_meta priority "-" held, then the JSON view: the same', async () => {
    const { user, el, held } = await metaHolds((card, u) => u.type(within(card).getByRole('spinbutton', { name: 'priority' }), '-'));
    const priorityHeld = t('ui.pending.notNumber', { field: 'limit-count._meta.priority', text: '-' });
    expect(held()).toEqual([priorityHeld]);
    await user.click(within(el).getByRole('button', { name: t('pl.card.json') }));
    const box = await jsonBox(el);
    await replaceCode(user, box, '{"count": 2,');
    expect(held()).toEqual([priorityHeld]);
    await user.click(metaToggle(el));
    expect(metaToggle(el)).toHaveAttribute('aria-expanded', 'true');
    expect(within(el).getByRole('spinbutton', { name: 'priority' })).toHaveValue('-');
  });

  it('the mirror order: the JSON view holds first, then _meta cannot start holding, and may collapse', async () => {
    const harness = renderPluginsTab({ scope: 'route', value: LIMIT });
    const el = await openCard(harness, 'limit-count');
    await harness.user.click(within(el).getByRole('button', { name: t('pl.card.json') }));
    await replaceCode(harness.user, await jsonBox(el), '{"count": 2,');
    const jsonHeld = t('ui.pending.json', { field: 'limit-count' });
    await harness.user.click(metaToggle(el));
    expect(within(el).queryByRole('spinbutton', { name: 'priority' })).not.toBeInTheDocument();
    await replaceCode(harness.user, await within(el).findByRole('textbox', { name: t('pl.meta.filterLabel') }), '[["a", ');
    expect(harness.held()).toEqual([jsonHeld]);
    await harness.user.click(metaToggle(el));
    expect(metaToggle(el)).toHaveAttribute('aria-expanded', 'false');
    expect(harness.held()).toEqual([jsonHeld]);
  });
});

