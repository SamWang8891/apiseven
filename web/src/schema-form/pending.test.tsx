// The generated form's fields and the pending-input guard: what a field shows but has not emitted
// (a number that doesn't parse, refused tag text, a withheld map row, JSON that doesn't parse or is
// not the schema's type) is declared through usePending, named by the field's dotted path (after
// the form's `name`, when it has one).
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { Obj } from '../api/types';
import { t } from '../i18n';
import { changeTo, reactProps } from '../test/reactProps';
import { renderSchemaForm } from '../test/schemaForm';
import { PendingProvider, type PendingEntry } from '../ui';
import { SchemaForm } from './SchemaForm';
import { getToasts } from '../ui/toast';

const SCHEMA: Obj = {
  type: 'object',
  properties: {
    count: { type: 'integer', minimum: 1 },
    tags: { type: 'array', items: { type: 'string', pattern: '^[a-z.]+$' } },
    headers: { type: 'object', additionalProperties: { type: 'string' } },
    limits: { type: 'object', additionalProperties: { type: 'integer' } },
    keyed: { type: 'object', patternProperties: { '^[a-z]+$': { type: 'integer' } } },
    body_schema: { type: 'object' },
  },
};

const group = (name: string) => within(screen.getByRole('group', { name: new RegExp(`^${name}`) }));

describe('schema-form fields hold what they do not emit', () => {
  it('a number field with text that is not a number, named by its path after the form name', async () => {
    const form = renderSchemaForm(SCHEMA, { count: 2 }, { name: 'limit-count' });
    const count = screen.getByRole('spinbutton', { name: /^count/ });
    await form.user.clear(count);
    await form.user.type(count, '-');
    expect(form.held()).toEqual([t('ui.pending.notNumber', { field: 'limit-count.count', text: '-' })]);
    expect(form.value()).toEqual({});
    await form.user.type(count, '3');
    expect(form.held()).toEqual([]);
    expect(form.value()).toEqual({ count: -3 });
  });

  it('tags: text the item schema refuses stays held; text that passes is added on leaving the box', async () => {
    const form = renderSchemaForm(SCHEMA, {});
    const tags = screen.getByRole('textbox', { name: /^tags/ });
    await form.user.type(tags, 'a.example.org');
    await form.user.tab();
    expect(form.value()).toEqual({ tags: ['a.example.org'] });
    await form.user.type(tags, 'BAD!');
    await form.user.tab();
    expect(form.held()).toEqual([t('ui.pending.tag', { field: 'tags', text: 'BAD!', reason: t('sf.pattern.invalid', { pattern: '^[a-z.]+$' }) })]);
    expect(form.value()).toEqual({ tags: ['a.example.org'] });
  });

  it('a key/value map row with a value but no key is held', async () => {
    const form = renderSchemaForm(SCHEMA, {});
    await form.user.type(group('headers').getByRole('textbox', { name: t('ui.kv.valueN', { n: 1 }) }), 'v');
    expect(form.held()).toEqual([t('ui.pending.noKey', { field: 'headers', n: 1 })]);
    await form.user.type(group('headers').getByRole('textbox', { name: t('ui.kv.keyN', { n: 1 }) }), 'X-A');
    expect(form.held()).toEqual([]);
    expect(form.value()).toEqual({ headers: { 'X-A': 'v' } });
  });

  // Task 16b item 32: a row without a key has only its place to be named by.
  it('a field inside a map row without a key is named by the row, by its place', async () => {
    const schema: Obj = {
      type: 'object',
      properties: {
        limits: { type: 'object', additionalProperties: { type: 'integer' } },
        pools: { type: 'object', additionalProperties: { type: 'object', properties: { port: { type: 'integer' } } } },
      },
    };
    const form = renderSchemaForm(schema, { limits: { a: 1 } }, { name: 'p' });
    await form.user.click(group('limits').getByRole('button', { name: t('sf.map.add') }));
    await form.user.type(group('limits').getByRole('spinbutton', { name: t('sf.map.valueOfEntry', { n: 2 }) }), '-');
    expect(form.held()).toEqual([t('ui.pending.notNumber', { field: t('sf.map.rowName', { field: 'p.limits', n: 2 }), text: '-' })]);
    await form.user.clear(group('limits').getByRole('spinbutton', { name: t('sf.map.valueOfEntry', { n: 2 }) }));
    await form.user.click(group('pools').getByRole('button', { name: t('sf.map.add') }));
    await form.user.type(group('pools').getByRole('spinbutton', { name: /^port/ }), '-');
    expect(form.held()).toEqual([t('ui.pending.notNumber', { field: `${t('sf.map.rowName', { field: 'p.pools', n: 1 })}.port`, text: '-' })]);
    expect(form.held().join()).not.toContain('~');
  });

  it('map rows: a key without a value, a repeated key and a key the pattern refuses are held', async () => {
    const form = renderSchemaForm(SCHEMA, { limits: { a: 1 }, keyed: { a: 1 } });
    await form.user.click(group('limits').getByRole('button', { name: t('sf.map.add') }));
    // A new row with nothing in it holds nothing.
    expect(form.held()).toEqual([]);
    const key2 = group('limits').getByRole('textbox', { name: t('sf.map.keyOf', { n: 2 }) });
    await form.user.type(key2, 'a');
    // Task 16b item 51: Save is refused and nothing is kept, so the refusal does not say "only the first is kept".
    expect(form.held()).toEqual([t('ui.pending.duplicateKey', { field: 'limits', key: 'a' })]);
    expect(form.held().join()).not.toContain(t('sf.map.duplicate', { key: 'a' }));
    expect(key2).toHaveAccessibleDescription(t('sf.map.duplicate', { key: 'a' }));
    await form.user.type(key2, 'b');
    expect(form.held()).toEqual([t('ui.pending.noValue', { field: 'limits', key: 'ab' })]);
    expect(key2).toHaveAccessibleDescription(t('sf.map.noValue'));
    await form.user.type(group('limits').getByRole('spinbutton', { name: t('sf.map.valueOf', { key: 'ab' }) }), '5');
    expect(form.held()).toEqual([]);
    expect(form.value()).toEqual({ limits: { a: 1, ab: 5 }, keyed: { a: 1 } });

    // A new row with a value but no key is flagged on its key.
    await form.user.click(group('limits').getByRole('button', { name: t('sf.map.add') }));
    await form.user.type(group('limits').getByRole('spinbutton', { name: t('sf.map.valueOfEntry', { n: 3 }) }), '7');
    expect(form.held()).toEqual([t('ui.pending.noKey', { field: 'limits', n: 3 })]);
    expect(group('limits').getByRole('textbox', { name: t('sf.map.keyOf', { n: 3 }) })).toHaveAccessibleDescription(t('sf.map.noKey'));
    await form.user.click(group('limits').getByRole('button', { name: t('sf.map.remove', { key: 3 }) }));

    await form.user.click(group('keyed').getByRole('button', { name: t('sf.map.add') }));
    await form.user.type(group('keyed').getByRole('textbox', { name: t('sf.map.keyOf', { n: 2 }) }), 'B1');
    expect(form.held()).toEqual([
      t('ui.pending.problem', { field: 'keyed', problem: t('sf.map.badKey', { key: 'B1', pattern: '^[a-z]+$' }) }),
    ]);
    await form.user.click(group('keyed').getByRole('button', { name: t('sf.map.remove', { key: 'B1' }) }));
    expect(form.held()).toEqual([]);
  });

  it('JSON that does not parse, or is not the type the schema asks for, is held and not emitted', async () => {
    const form = renderSchemaForm(SCHEMA, { body_schema: { type: 'string' } });
    const editor = await screen.findByRole('textbox', { name: t('sf.json.label', { key: 'body_schema' }) });
    await form.user.click(editor);
    await form.user.keyboard('{Control>}a{/Control}');
    await form.user.paste('{"type": ');
    expect(form.held()).toEqual([t('ui.pending.json', { field: 'body_schema' })]);
    expect(editor).toHaveAttribute('aria-invalid', 'true');
    await form.user.keyboard('{Control>}a{/Control}');
    await form.user.paste('["object"]');
    expect(form.held()).toEqual([t('ui.pending.jsonType', { field: 'body_schema', type: 'object' })]);
    expect(screen.getByText(t('sf.json.type', { type: 'object' }))).toBeInTheDocument();
    expect(form.changes).not.toHaveBeenCalled();
    await form.user.keyboard('{Control>}a{/Control}');
    await form.user.paste('{"type": "object"}');
    expect(form.held()).toEqual([]);
    expect(form.value()).toEqual({ body_schema: { type: 'object' } });
    expect(editor).not.toHaveAttribute('aria-invalid');
  });
});

describe('a part that would hide a field holding input stays as it is', () => {
  it('a group does not collapse while a field in it holds input; the toast names it', async () => {
    const schema: Obj = { type: 'object', properties: { redis: { type: 'object', properties: { port: { type: 'integer' } } } } };
    const form = renderSchemaForm(schema, { redis: { port: 6379 } });
    const port = screen.getByRole('spinbutton', { name: 'port' });
    await form.user.clear(port);
    await form.user.type(port, 'x');
    const toggle = screen.getByRole('button', { name: 'redis' });
    await form.user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(port).toHaveValue('x');
    expect(port).toHaveFocus();
    expect(getToasts().at(-1)?.message).toBe(t('ui.pending.refused', { message: t('ui.pending.notNumber', { field: 'redis.port', text: 'x' }) }));
    await form.user.clear(port);
    await form.user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('a variant does not switch while a field of the current form holds input', async () => {
    const schema: Obj = {
      type: 'object',
      properties: {
        target: {
          oneOf: [
            { type: 'object', title: 'Upstream', properties: { kind: { const: 'upstream' }, host: { type: 'string' }, timeout: { type: 'integer' } } },
            { type: 'object', title: 'Service', properties: { kind: { const: 'service' }, service_id: { type: 'string' }, timeout: { type: 'integer' } } },
          ],
        },
      },
    };
    const form = renderSchemaForm(schema, { target: { kind: 'upstream', host: 'h', timeout: 5 } });
    const timeout = screen.getByRole('spinbutton', { name: 'timeout' });
    await form.user.clear(timeout);
    await form.user.type(timeout, '-');
    const picker = screen.getByRole('combobox', { name: 'target' });
    await form.user.click(picker);
    await form.user.click(screen.getByRole('option', { name: 'Service' }));
    expect(picker).toHaveTextContent('Upstream');
    expect(screen.getByRole('spinbutton', { name: 'timeout' })).toHaveValue('-');
    expect(form.value()).toEqual({ target: { kind: 'upstream', host: 'h' } });
  });
});

/** The form, and a button that replaces the value from outside (as another control of the page would). */
function renderWithOutside(initial: Obj, outside: (value: Obj) => Obj) {
  let pending: PendingEntry[] = [];
  let current: unknown = initial;
  function Page() {
    const [value, setValue] = useState<Obj>(initial);
    const set = (v: Obj) => {
      current = v;
      setValue(v);
    };
    return (
      <PendingProvider onChange={(entries) => (pending = entries)}>
        <SchemaForm schema={SCHEMA} value={value} onChange={(v) => set(v as Obj)} />
        <button type="button" onClick={() => set(outside(value))}>
          Elsewhere
        </button>
      </PendingProvider>
    );
  }
  const user = userEvent.setup();
  render(<Page />);
  return { user, held: () => pending.map((e) => e.message), value: () => current };
}

describe('held input is never replaced by a value from outside', () => {
  it('JSON text that does not parse stays when the value changes from outside; fixed, it is what is emitted', async () => {
    const page = renderWithOutside({ body_schema: { type: 'string' } }, (v) => ({ ...v, body_schema: { type: 'number' } }));
    const editor = await screen.findByRole('textbox', { name: t('sf.json.label', { key: 'body_schema' }) });
    await page.user.click(editor);
    await page.user.keyboard('{Control>}a{/Control}');
    await page.user.paste('{"type": ');
    await page.user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(editor.textContent).toBe('{"type": ');
    expect(page.held()).toEqual([t('ui.pending.json', { field: 'body_schema' })]);
    await page.user.click(editor);
    await page.user.keyboard('{Control>}a{/Control}');
    await page.user.paste('{"type": "object"}');
    expect(page.held()).toEqual([]);
    expect(page.value()).toEqual({ body_schema: { type: 'object' } });
  });

  it('a held map row stays when the map changes from outside', async () => {
    const page = renderWithOutside({ limits: { a: 1 } }, (v) => ({ ...v, limits: { a: 1, c: 3 } }));
    await page.user.click(group('limits').getByRole('button', { name: t('sf.map.add') }));
    await page.user.type(group('limits').getByRole('textbox', { name: t('sf.map.keyOf', { n: 2 }) }), 'b');
    await page.user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(group('limits').getAllByRole('textbox').map((el) => (el as HTMLInputElement).value)).toEqual(['a', 'c', 'b']);
    // Carried over the change: held as not saved until it is edited (fix round 3).
    expect(page.held()).toEqual([t('ui.pending.kept', { field: 'limits', n: 3 })]);
  });
});

describe('editing state ends on lock', () => {
  it('a blank map row added while editing is gone from the locked view and the next edit', async () => {
    const form = renderSchemaForm(SCHEMA, { limits: { a: 1 } });
    await form.user.click(group('limits').getByRole('button', { name: t('sf.map.add') }));
    expect(group('limits').getAllByRole('textbox')).toHaveLength(2);
    form.update({ locked: true });
    expect(screen.getByRole('group', { name: /^limits/ }).querySelectorAll('.sf-map__row')).toHaveLength(1);
    form.update({ locked: false });
    expect(group('limits').getAllByRole('textbox')).toHaveLength(1);
  });
});

describe('a list of objects', () => {
  it('removing an earlier item keeps a later item\'s held "-" on that item, named by its new path', async () => {
    const schema: Obj = { type: 'object', properties: { nodes: { type: 'array', items: { type: 'object', properties: { host: { type: 'string' }, port: { type: 'integer' } } } } } };
    const form = renderSchemaForm(schema, { nodes: [{ host: 'a', port: 1 }, { host: 'b', port: 2 }, { host: 'c', port: 3 }] });
    const ports = () => screen.getAllByRole('spinbutton', { name: 'port' });
    await form.user.clear(ports()[2] as HTMLElement);
    await form.user.type(ports()[2] as HTMLElement, '-');
    expect(form.held()).toEqual([t('ui.pending.notNumber', { field: 'nodes.2.port', text: '-' })]);
    await form.user.click(screen.getByRole('button', { name: t('sf.list.remove', { n: 1 }) }));
    expect(screen.getAllByRole('textbox', { name: 'host' }).map((el) => (el as HTMLInputElement).value)).toEqual(['b', 'c']);
    expect(ports().map((el) => (el as HTMLInputElement).value)).toEqual(['2', '-']);
    expect(form.held()).toEqual([t('ui.pending.notNumber', { field: 'nodes.1.port', text: '-' })]);
  });
});

describe('a kept map row is a new row', () => {
  it('a stored key emptied, kept through an outside change, then typed again: held as used twice', async () => {
    const page = renderWithOutside({ limits: { a: 1 } }, (v) => ({ ...v, limits: { a: 5 } }));
    const key1 = group('limits').getByRole('textbox', { name: t('sf.map.keyOf', { n: 1 }) });
    await page.user.clear(key1);
    await page.user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(group('limits').getAllByRole('textbox').map((el) => (el as HTMLInputElement).value)).toEqual(['a', '']);
    await page.user.type(group('limits').getByRole('textbox', { name: t('sf.map.keyOf', { n: 2 }) }), 'a');
    expect(page.held()).toEqual([t('ui.pending.duplicateKey', { field: 'limits', key: 'a' })]);
    expect(page.value()).toEqual({ limits: { a: 5 } });
  });
});

describe('a held rename keeps the stored entry in the map (R8)', () => {
  it('map rows: an empty, taken or pattern-refused key, or no value, keeps the last good entry in its place; a valid rename replaces it', async () => {
    const form = renderSchemaForm(SCHEMA, { limits: { a: 1, b: 2 }, keyed: { x: 1, y: 2 } });
    const key = (field: string, n: number) => group(field).getByRole('textbox', { name: t('sf.map.keyOf', { n }) });

    await form.user.clear(key('limits', 1));
    expect(form.value()).toEqual({ limits: { a: 1, b: 2 }, keyed: { x: 1, y: 2 } });
    expect(form.held()).toEqual([t('ui.pending.noKey', { field: 'limits', n: 1 })]);
    await form.user.type(key('limits', 1), 'b');
    expect(form.value()).toEqual({ limits: { a: 1, b: 2 }, keyed: { x: 1, y: 2 } });
    expect(form.held()).toEqual([t('ui.pending.duplicateKey', { field: 'limits', key: 'b' })]);
    // A value cleared meanwhile: still the last good entry.
    // Row 1 shows "b" now too: its value field is the first of the two named after b.
    await form.user.clear(group('limits').getAllByRole('spinbutton', { name: t('sf.map.valueOf', { key: 'b' }) })[0] as HTMLElement);
    expect(form.value()).toEqual({ limits: { a: 1, b: 2 }, keyed: { x: 1, y: 2 } });
    await form.user.type(key('limits', 1), 'c');
    expect(form.held()).toEqual([t('ui.pending.noValue', { field: 'limits', key: 'bc' })]);
    expect(form.value()).toEqual({ limits: { a: 1, b: 2 }, keyed: { x: 1, y: 2 } });
    await form.user.type(group('limits').getByRole('spinbutton', { name: t('sf.map.valueOf', { key: 'bc' }) }), '7');
    expect(form.held()).toEqual([]);
    expect(form.value()).toEqual({ limits: { bc: 7, b: 2 }, keyed: { x: 1, y: 2 } });
    expect(Object.keys((form.value() as Obj).limits as Obj)).toEqual(['bc', 'b']);

    // A key the pattern refuses: held, the entry stays where it was.
    await form.user.clear(key('keyed', 1));
    await form.user.type(key('keyed', 1), 'X1');
    expect(form.held()).toEqual([t('ui.pending.problem', { field: 'keyed', problem: t('sf.map.badKey', { key: 'X1', pattern: '^[a-z]+$' }) })]);
    expect((form.value() as Obj).keyed).toEqual({ x: 1, y: 2 });
    await form.user.clear(key('keyed', 1));
    await form.user.type(key('keyed', 1), 'z');
    expect((form.value() as Obj).keyed).toEqual({ z: 1, y: 2 });
    expect(Object.keys((form.value() as Obj).keyed as Obj)).toEqual(['z', 'y']);
  });
});

describe('map rows always send what they show (fix round 2)', () => {
  const key = (n: number) => group('limits').getByRole('textbox', { name: t('sf.map.keyOf', { n }) });

  it("the reviewer's sequence: key 2 → a (held), key 1 → c, leave: the value is what the rows show", async () => {
    const form = renderSchemaForm(SCHEMA, { limits: { a: 1, b: 2 } });
    await form.user.clear(key(2));
    await form.user.type(key(2), 'a');
    expect(form.held()).toEqual([t('ui.pending.duplicateKey', { field: 'limits', key: 'a' })]);
    await form.user.clear(key(1));
    await form.user.type(key(1), 'c');
    await form.user.click(document.body);
    expect(form.held()).toEqual([]);
    expect(form.value()).toEqual({ limits: { c: 1, a: 2 } });
    expect(Object.keys((form.value() as Obj).limits as Obj)).toEqual(['c', 'a']);
  });

  it('two rows swap keys', async () => {
    const form = renderSchemaForm(SCHEMA, { limits: { a: 1, b: 2 } });
    await form.user.clear(key(1));
    await form.user.type(key(1), 'b');
    await form.user.clear(key(2));
    await form.user.type(key(2), 'a');
    expect(form.held()).toEqual([]);
    await form.user.click(document.body);
    expect(form.value()).toEqual({ limits: { b: 1, a: 2 } });
  });
});

describe('map rows equal their value after an outside change too (fix round 3)', () => {
  it('a "used twice" row kept through a change that drops its rival stays held until edited', async () => {
    const page = renderWithOutside({ limits: { a: 1, b: 2 } }, () => ({ limits: { b: 2 } }));
    const key = (n: number) => group('limits').getByRole('textbox', { name: t('sf.map.keyOf', { n }) });
    await page.user.clear(key(2));
    await page.user.type(key(2), 'a');
    await page.user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(group('limits').getAllByRole('textbox').map((el) => (el as HTMLInputElement).value)).toEqual(['a']);
    expect(page.value()).toEqual({ limits: { b: 2 } });
    expect(page.held()).toEqual([t('ui.pending.kept', { field: 'limits', n: 1 })]);
    await page.user.type(group('limits').getByRole('spinbutton', { name: t('sf.map.valueOf', { key: 'a' }) }), '0');
    expect(page.held()).toEqual([]);
    expect(page.value()).toEqual({ limits: { a: 20 } });
  });

  it('a key edit and leaving the row, or two row edits, in one task all land (no stale rows)', () => {
    const form = renderSchemaForm(SCHEMA, { limits: { a: 1, b: 2 } });
    const key = (n: number) => group('limits').getByRole('textbox', { name: t('sf.map.keyOf', { n }) });
    // Handlers from the same render, no render between (as two handlers in one task would run).
    const [key2, row2] = [reactProps(key(2)), reactProps(key(2).closest('.sf-map__row') as Element)];
    act(() => {
      key2.onChange?.(changeTo('a'));
      row2.onBlur?.();
    });
    expect(key(2)).toHaveValue('a');
    expect(form.held()).toEqual([t('ui.pending.duplicateKey', { field: 'limits', key: 'a' })]);
    const [key1, key2again] = [reactProps(key(1)), reactProps(key(2))];
    act(() => {
      key1.onChange?.(changeTo(''));
      key2again.onChange?.(changeTo('c'));
    });
    expect(key(1)).toHaveValue('');
    expect(key(2)).toHaveValue('c');
    expect(form.value()).toEqual({ limits: { a: 1, c: 2 } });
  });
});
