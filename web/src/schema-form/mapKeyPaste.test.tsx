// Codex final pass, X3: a private key pasted into a value of a map shown as the key/value editor. The
// value then needs the rows (whose fields never show a key), but the key/value editor stays while the
// user is in it, without setting state as it renders (that looped: "Too many re-renders"); the rows
// take over when the field is left, starting from the editor's own rows, so another row's unfinished
// input is kept (final wave D3: a renderer switch never discards another row's edit).
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { schemaOf } from '../test/pluginFixture';
import { renderSchemaForm } from '../test/schemaForm';

const BODY = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAAmapPastedKey';
// One line: what a single-line box keeps of a pasted PEM.
const KEY = `-----BEGIN PRIVATE KEY----- ${BODY}${'A'.repeat(100)} -----END PRIVATE KEY-----`;
const inPage = (text: string) => document.body.innerHTML.includes(text) || (document.body.textContent ?? '').includes(text);
const group = (name: string) => within(screen.getByRole('group', { name: new RegExp(`^${name}`) }));

describe('a private key pasted into a map value (proxy-rewrite headers.set, 3.20)', () => {
  it('is taken with no render loop and shows while typed; once the map is left it is hidden, and a second row holding unfinished input keeps it', async () => {
    const form = renderSchemaForm(schemaOf('proxy-rewrite'), { headers: { set: { 'X-A': 'a', 'X-B': 'b' } } }, { name: 'proxy-rewrite' });
    const field = 'proxy-rewrite.headers.set';
    // The second row holds unfinished input: its key cleared, its value kept.
    await form.user.clear(group('set').getByRole('textbox', { name: t('ui.kv.keyN', { n: 2 }) }));
    const held = [t('ui.pending.noKey', { field, n: 2 })];
    expect(form.held()).toEqual(held);

    const value1 = group('set').getByRole('textbox', { name: t('ui.kv.valueN', { n: 1 }) });
    await form.user.click(value1);
    await form.user.keyboard('{Control>}a{/Control}');
    await form.user.paste(KEY);
    expect(value1).toHaveFocus();
    expect(value1).toHaveValue(KEY);
    expect(form.value()).toEqual({ headers: { set: { 'X-A': KEY, 'X-B': 'b' } } });
    expect(form.held()).toEqual(held);

    // Left: the rows show the map, the key in words only; the second row is as it was, and still held.
    await form.user.click(document.body);
    await waitFor(() => expect(inPage(BODY)).toBe(false));
    const rows = group('set');
    expect(rows.getByText(t('sf.secret.set'))).toBeInTheDocument();
    expect(rows.getByRole('textbox', { name: t('sf.map.keyOf', { n: 1 }) })).toHaveValue('X-A');
    expect(rows.getByRole('textbox', { name: t('sf.map.keyOf', { n: 2 }) })).toHaveValue('');
    expect(rows.getByRole('textbox', { name: t('sf.map.valueOfEntry', { n: 2 }) })).toHaveValue('b');
    expect(form.held()).toEqual(held);
    expect(form.value()).toEqual({ headers: { set: { 'X-A': KEY, 'X-B': 'b' } } });

    // The row is finished there: the map is the rows as shown.
    await form.user.type(rows.getByRole('textbox', { name: t('sf.map.keyOf', { n: 2 }) }), 'X-C');
    expect(form.held()).toEqual([]);
    expect(form.value()).toEqual({ headers: { set: { 'X-A': KEY, 'X-C': 'b' } } });
    expect(inPage(BODY)).toBe(false);
  });

  it('with nothing else held: left, the rows take over with every entry, the key in words only', async () => {
    const form = renderSchemaForm(schemaOf('proxy-rewrite'), { headers: { set: { 'X-A': 'a', 'X-B': 'b' } } }, { name: 'proxy-rewrite' });
    const value2 = group('set').getByRole('textbox', { name: t('ui.kv.valueN', { n: 2 }) });
    await form.user.click(value2);
    await form.user.keyboard('{Control>}a{/Control}');
    await form.user.paste(KEY);
    expect(inPage(BODY)).toBe(true);
    await form.user.click(document.body);
    await waitFor(() => expect(inPage(BODY)).toBe(false));
    const rows = group('set');
    expect(rows.getByRole('textbox', { name: t('sf.map.keyOf', { n: 1 }) })).toHaveValue('X-A');
    expect(rows.getByRole('textbox', { name: t('sf.map.keyOf', { n: 2 }) })).toHaveValue('X-B');
    expect(rows.getByText(t('sf.secret.set'))).toBeInTheDocument();
    expect(form.held()).toEqual([]);
    expect(form.value()).toEqual({ headers: { set: { 'X-A': 'a', 'X-B': KEY } } });
  });
});

/**
 * Every string the component named `component` around `el`, and every component below it, keeps in its
 * hooks (state, refs, memos and their deps), read from React's committed fiber tree (not the work-in-
 * progress copy React keeps of the render before): what the field retains. Nothing of the app is
 * exported for it.
 */
function retainedStrings(el: Element, component: string): string[] {
  interface Fiber { type: unknown; tag: number; return: Fiber | null; child: Fiber | null; sibling: Fiber | null; memoizedState: unknown; stateNode: unknown }
  const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
  let top = key ? ((el as unknown as Record<string, Fiber | undefined>)[key] ?? null) : null;
  while (top?.return) top = top.return;
  // The host root's FiberRoot knows which of the two trees is the committed one.
  const committed = (top?.stateNode as { current?: Fiber } | undefined)?.current ?? null;
  const find = (f: Fiber | null, test: (f: Fiber) => boolean): Fiber | null => {
    for (let at = f; at; at = at.sibling) {
      if (test(at)) return at;
      const below = find(at.child, test);
      if (below) return below;
    }
    return null;
  };
  let fiber = find(committed, (f) => f.stateNode === el);
  const named = (f: Fiber) => typeof f.type === 'function' && (f.type as { name?: string }).name === component;
  while (fiber && !named(fiber)) fiber = fiber.return;
  if (!fiber) throw new Error(`no ${component} above the element`);
  const out: string[] = [];
  const seen = new WeakSet<object>();
  const visit = (v: unknown, depth: number) => {
    if (typeof v === 'string') out.push(v);
    if (v === null || typeof v !== 'object' || depth > 16 || seen.has(v)) return;
    seen.add(v);
    if ('$$typeof' in v || v instanceof Node) return;
    for (const x of Array.isArray(v) ? (v as unknown[]) : Object.values(v)) visit(x, depth + 1);
  };
  // Function components (0), forwardRef (11), memo (14, 15): their memoizedState is their hooks.
  const walk = (f: Fiber | null) => {
    for (let at = f; at; at = at.sibling) {
      if ([0, 11, 14, 15].includes(at.tag)) visit(at.memoizedState, 0);
      walk(at.child);
    }
  };
  if ([0, 11, 14, 15].includes(fiber.tag)) visit(fiber.memoizedState, 0);
  walk(fiber.child);
  return out;
}

// Codex final pass 2b, V1: once the rows have taken over from the key/value editor, the field keeps no
// copy of the editor's rows: a key replaced afterwards is in nothing it retains, and a lock changes none of that.
describe('a key pasted into a map value, handed to the rows, then replaced (V1)', () => {
  const A = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAAmapKeyFirstA';
  const B = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAAmapKeySecondB';
  const keyOf = (body: string) => `-----BEGIN PRIVATE KEY----- ${body}${'A'.repeat(100)} -----END PRIVATE KEY-----`;
  const holds = (body: string) => retainedStrings(screen.getByRole('group', { name: /^set/ }), 'MapField').some((s) => s.includes(body));

  it('after the replacement, and after a lock, the field retains nothing of A; a later hand-over never brings it back', async () => {
    const form = renderSchemaForm(schemaOf('proxy-rewrite'), { headers: { set: { 'X-A': 'a' } } }, { name: 'proxy-rewrite' });
    const value1 = group('set').getByRole('textbox', { name: t('ui.kv.valueN', { n: 1 }) });
    await form.user.click(value1);
    await form.user.keyboard('{Control>}a{/Control}');
    await form.user.paste(keyOf(A));
    await form.user.click(document.body);
    await waitFor(() => expect(inPage(A)).toBe(false));

    // Replaced in the rows by B, and left.
    await form.user.click(group('set').getByRole('button', { name: t('sf.secret.replace', { name: t('sf.map.valueOf', { key: 'X-A' }) }) }));
    await form.user.click(group('set').getByRole('textbox', { name: t('sf.map.valueOf', { key: 'X-A' }) }));
    await form.user.paste(keyOf(B));
    await form.user.click(document.body);
    await waitFor(() => expect(inPage(B)).toBe(false));
    expect(form.value()).toEqual({ headers: { set: { 'X-A': keyOf(B) } } });
    // The walk reads what the field holds: B, the value it shows.
    expect(holds(B)).toBe(true);
    expect(holds(A)).toBe(false);

    form.update({ locked: true });
    expect(holds(A)).toBe(false);
    form.update({ locked: false });
    expect(holds(A)).toBe(false);

    // The row removed, the map is a key/value editor again; a new key there is handed over as before, A nowhere.
    await form.user.click(group('set').getByRole('button', { name: t('sf.map.remove', { key: 'X-A' }) }));
    await form.user.click(group('set').getByRole('button', { name: t('ui.kv.add') }));
    await form.user.type(group('set').getByRole('textbox', { name: t('ui.kv.keyN', { n: 1 }) }), 'X-C');
    await form.user.click(group('set').getByRole('textbox', { name: t('ui.kv.valueN', { n: 1 }) }));
    await form.user.paste(keyOf('MIIEvQIBADANBgkqhkiG9w0BAQEFAAmapKeyThirdC'));
    await form.user.click(document.body);
    await waitFor(() => expect(inPage('mapKeyThirdC')).toBe(false));
    expect(form.value()).toEqual({ headers: { set: { 'X-C': keyOf('MIIEvQIBADANBgkqhkiG9w0BAQEFAAmapKeyThirdC') } } });
    expect(inPage(A) || holds(A) || holds(B)).toBe(false);
  });
});
