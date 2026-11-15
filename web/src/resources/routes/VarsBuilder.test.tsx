// The route's conditions (`vars`): rows for a flat list, JSON for anything else, and what the rows
// show but have not emitted held from Save.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { t } from '../../i18n';
import { LockProvider, PendingProvider, TooltipProvider, type PendingEntry } from '../../ui';
import { VarsBuilder } from './VarsBuilder';

function renderVars(initial: unknown, { locked = false }: { locked?: boolean } = {}) {
  const changes = vi.fn<(v: unknown) => void>();
  let current = initial;
  let pending: PendingEntry[] = [];
  function Harness({ locked: isLocked }: { locked: boolean }) {
    const [value, setValue] = useState(initial);
    return (
      <TooltipProvider>
        <PendingProvider onChange={(entries) => (pending = entries)}>
          <LockProvider locked={isLocked}>
            <VarsBuilder
              value={value}
              onChange={(v) => {
                current = v;
                changes(v);
                setValue(v);
              }}
            />
          </LockProvider>
        </PendingProvider>
      </TooltipProvider>
    );
  }
  const user = userEvent.setup();
  const result = render(<Harness locked={locked} />);
  return {
    ...result,
    user,
    changes,
    value: () => current,
    held: () => pending.map((e) => e.message),
    relock: (next: boolean) => result.rerender(<Harness locked={next} />),
  };
}

const variable = (n: number) => screen.getByRole('combobox', { name: t('rt.vars.variableN', { n }) });
const valueBox = (n: number) => screen.getByRole('textbox', { name: t('rt.vars.valueN', { n }) });
const valuesBox = (n: number) => screen.getByRole('textbox', { name: t('rt.vars.valuesN', { n }) });
const negate = (n: number) => screen.getByRole('checkbox', { name: t('rt.vars.notN', { n }) });

async function chooseOp(user: ReturnType<typeof userEvent.setup>, n: number, op: string) {
  await user.click(screen.getByRole('combobox', { name: t('rt.vars.operatorN', { n }) }));
  const option = (await screen.findAllByRole('option')).find((o) => o.querySelector('.ui-select__label')?.textContent === op);
  if (!option) throw new Error(`no option ${op}`);
  await user.click(option);
}

async function addRow(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: t('rt.vars.add') }));
}

describe('VarsBuilder rows', () => {
  it('round-trips a flat list: nothing is emitted until a row changes, and a change back gives the same value', async () => {
    const initial = [['arg_id', '==', '1'], ['http_x', '~~', '^a']];
    const h = renderVars(initial);
    expect(variable(1)).toHaveValue('arg_id');
    expect(valueBox(1)).toHaveValue('1');
    expect(variable(2)).toHaveValue('http_x');
    expect(valueBox(2)).toHaveValue('^a');
    expect(h.changes).not.toHaveBeenCalled();

    await h.user.type(valueBox(1), '2');
    expect(h.value()).toEqual([['arg_id', '==', '12'], ['http_x', '~~', '^a']]);
    await h.user.type(valueBox(1), '{Backspace}');
    expect(h.value()).toEqual(initial);
  });

  it('round-trips a negated (four-element) condition, and the not toggle writes or removes "!"', async () => {
    const h = renderVars([['arg_a', '!', '==', 'x']]);
    expect(negate(1)).toBeChecked();
    await h.user.type(valueBox(1), 'y');
    expect(h.value()).toEqual([['arg_a', '!', '==', 'xy']]);
    await h.user.click(negate(1));
    expect(h.value()).toEqual([['arg_a', '==', 'xy']]);
    await h.user.click(negate(1));
    expect(h.value()).toEqual([['arg_a', '!', '==', 'xy']]);
  });

  it('`in` takes tags and emits an array', async () => {
    const h = renderVars(undefined);
    await addRow(h.user);
    await h.user.type(variable(1), 'arg_id');
    await chooseOp(h.user, 1, 'in');
    await h.user.type(valuesBox(1), 'a{Enter}b{Enter}');
    expect(h.value()).toEqual([['arg_id', 'in', ['a', 'b']]]);
  });

  it('a numeric comparison emits a number; text that is not one is held, the last number staying in the value', async () => {
    const h = renderVars(undefined);
    await addRow(h.user);
    await h.user.type(variable(1), 'arg_age');
    await chooseOp(h.user, 1, '>');
    await h.user.type(valueBox(1), '18');
    expect(h.value()).toEqual([['arg_age', '>', 18]]);

    await h.user.clear(valueBox(1));
    await h.user.type(valueBox(1), 'abc');
    expect(h.value()).toEqual([['arg_age', '>', 18]]);
    expect(h.held()).toEqual([t('rt.vars.held.notNumber', { n: 1, text: 'abc' })]);
    expect(valueBox(1)).toHaveAttribute('aria-invalid', 'true');
  });

  it('a number in a list falls back to JSON; adding "!" there keeps the numbers', async () => {
    const h = renderVars([['post_arg.id', 'in', [1, 2]]]);
    const box = await screen.findByRole('textbox', { name: t('rt.vars.json') });
    expect(screen.queryByRole('combobox', { name: t('rt.vars.variableN', { n: 1 }) })).not.toBeInTheDocument();
    await h.user.click(box);
    await h.user.keyboard('{Control>}a{/Control}');
    await h.user.paste('[["post_arg.id", "!", "in", [1, 2]]]');
    expect(h.value()).toEqual([['post_arg.id', '!', 'in', [1, 2]]]);
  });

  it('ticking "not" on a `has` with a number keeps the number', async () => {
    const h = renderVars([['post_arg.tags', 'has', 7]]);
    await h.user.click(negate(1));
    expect(h.value()).toEqual([['post_arg.tags', '!', 'has', 7]]);
  });

  it('a held middle row keeps its stored condition, in order; fixed, it replaces it', async () => {
    const h = renderVars([['a', '==', '1'], ['b', '>', 2], ['c', '==', '3']]);
    await h.user.clear(valueBox(2));
    await h.user.type(valueBox(2), 'abc');
    expect(h.held()).toEqual([t('rt.vars.held.notNumber', { n: 2, text: 'abc' })]);
    expect(h.value()).toEqual([['a', '==', '1'], ['b', '>', 2], ['c', '==', '3']]);
    await h.user.clear(variable(2));
    expect(h.value()).toEqual([['a', '==', '1'], ['b', '>', 2], ['c', '==', '3']]);
    await h.user.type(variable(2), 'b');
    await h.user.clear(valueBox(2));
    await h.user.type(valueBox(2), '5');
    expect(h.held()).toEqual([]);
    expect(h.value()).toEqual([['a', '==', '1'], ['b', '>', 5], ['c', '==', '3']]);
  });

  it('a number compared with == stays a number while the text is one', async () => {
    const h = renderVars([['arg_id', '==', 1]]);
    await h.user.type(valueBox(1), '0');
    expect(h.value()).toEqual([['arg_id', '==', 10]]);
  });

  it('a value without a variable is held; a blank row holds nothing and emits nothing', async () => {
    const h = renderVars([['arg_a', '==', 'x']]);
    await addRow(h.user);
    expect(h.held()).toEqual([]);
    expect(h.changes).not.toHaveBeenCalled();
    await h.user.type(valueBox(2), 'v');
    expect(h.held()).toEqual([t('rt.vars.held.noVariable', { n: 2 })]);
    expect(h.value()).toEqual([['arg_a', '==', 'x']]);
    await h.user.type(variable(2), 'arg_b');
    expect(h.held()).toEqual([]);
    expect(h.value()).toEqual([['arg_a', '==', 'x'], ['arg_b', '==', 'v']]);
  });

  it('removing the last row removes vars', async () => {
    const h = renderVars([['arg_a', '==', 'x']]);
    await h.user.click(screen.getByRole('button', { name: t('rt.vars.removeN', { n: 1 }) }));
    expect(h.value()).toBeUndefined();
    expect(h.changes).toHaveBeenLastCalledWith(undefined);
  });

  it('reorders rows', async () => {
    const h = renderVars([['a', '==', '1'], ['b', '==', '2']]);
    await h.user.click(screen.getByRole('button', { name: t('rt.vars.downN', { n: 1 }) }));
    expect(h.value()).toEqual([['b', '==', '2'], ['a', '==', '1']]);
    await h.user.click(screen.getByRole('button', { name: t('rt.vars.upN', { n: 2 }) }));
    expect(h.value()).toEqual([['a', '==', '1'], ['b', '==', '2']]);
  });

  it('rows keep their own input when a row above them is removed', async () => {
    const h = renderVars([['a', '==', '1'], ['b', '>', 2], ['c', 'ipmatch', ['10.0.0.1']]]);
    // Row 2 holds text that is not a number; row 3 holds address text its tag box refused.
    await h.user.clear(valueBox(2));
    await h.user.type(valueBox(2), 'abc');
    await h.user.type(valuesBox(3), 'nope{Enter}');
    await h.user.click(screen.getByRole('button', { name: t('rt.vars.removeN', { n: 1 }) }));

    expect(variable(1)).toHaveValue('b');
    expect(valueBox(1)).toHaveValue('abc');
    expect(variable(2)).toHaveValue('c');
    expect(valuesBox(2)).toHaveValue('nope');
    expect(h.held()).toEqual(
      expect.arrayContaining([
        t('rt.vars.held.notNumber', { n: 1, text: 'abc' }),
        t('ui.pending.tag', { field: t('rt.vars.valuesN', { n: 2 }), text: 'nope', reason: t('rt.issue.addr', { addr: 'nope' }) }),
      ]),
    );
    // The held row keeps its last good condition in the value, in its place.
    expect(h.value()).toEqual([['b', '>', 2], ['c', 'ipmatch', ['10.0.0.1']]]);
    await h.user.clear(valueBox(1));
    await h.user.type(valueBox(1), '3');
    expect(h.value()).toEqual([['b', '>', 3], ['c', 'ipmatch', ['10.0.0.1']]]);
  });

  it('ipmatch refuses text that is not an address, and holds a row with none', async () => {
    const h = renderVars(undefined);
    await addRow(h.user);
    await h.user.type(variable(1), 'remote_addr');
    await chooseOp(h.user, 1, 'ipmatch');
    expect(h.held()).toEqual([t('rt.vars.held.noAddress', { n: 1 })]);
    await h.user.type(valuesBox(1), 'nope{Enter}');
    expect(h.held()).toContain(t('ui.pending.tag', { field: t('rt.vars.valuesN', { n: 1 }), text: 'nope', reason: t('rt.issue.addr', { addr: 'nope' }) }));
    await h.user.clear(valuesBox(1));
    await h.user.type(valuesBox(1), '10.0.0.0/8{Enter}');
    expect(h.held()).toEqual([]);
    expect(h.value()).toEqual([['remote_addr', 'ipmatch', ['10.0.0.0/8']]]);
  });
});

describe('VarsBuilder JSON', () => {
  const NESTED = [['OR', ['arg_a', '==', '1'], ['arg_b', '==', '2']]];

  it('shows nested groups as JSON, with a note, and emits nothing unless it is edited', async () => {
    const h = renderVars(NESTED);
    expect(await screen.findByRole('textbox', { name: t('rt.vars.json') })).toBeInTheDocument();
    expect(screen.getByText(t('rt.vars.jsonNote'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('rt.vars.asRows') })).not.toBeInTheDocument();
    expect(h.changes).not.toHaveBeenCalled();
    expect(h.value()).toBe(NESTED);
  });

  it('switches to JSON from rows and back while the JSON can be rows', async () => {
    const h = renderVars([['arg_a', '==', 'x']]);
    await h.user.click(screen.getByRole('button', { name: t('rt.vars.asJson') }));
    const editor = await screen.findByRole('textbox', { name: t('rt.vars.json') });
    expect(editor.textContent?.replace(/\s/g, '')).toBe('[["arg_a","==","x"]]');
    expect(h.changes).not.toHaveBeenCalled();

    await h.user.click(screen.getByRole('button', { name: t('rt.vars.asRows') }));
    expect(variable(1)).toHaveValue('arg_a');
  });

  it('holds JSON that does not parse or is not a list; a list is emitted, an empty one removes vars', async () => {
    const h = renderVars(NESTED);
    const editor = await screen.findByRole('textbox', { name: t('rt.vars.json') });
    await h.user.click(editor);
    await h.user.keyboard('{Control>}a{/Control}');
    await h.user.paste('[["a", "==",');
    expect(h.held()).toEqual([t('rt.vars.held.json')]);
    expect(h.value()).toBe(NESTED);

    await h.user.keyboard('{Control>}a{/Control}');
    await h.user.paste('{"a": 1}');
    expect(h.held()).toEqual([t('rt.vars.held.jsonList')]);

    await h.user.keyboard('{Control>}a{/Control}');
    await h.user.paste('[["a", "==", "1"]]');
    expect(h.held()).toEqual([]);
    expect(h.value()).toEqual([['a', '==', '1']]);
    // Now representable, so the rows are offered.
    expect(screen.getByRole('button', { name: t('rt.vars.asRows') })).toBeInTheDocument();

    await h.user.keyboard('{Control>}a{/Control}');
    await h.user.paste('[]');
    expect(h.value()).toBeUndefined();
  });

  // Final wave E3: APISIX takes `vars: {}` as an empty list (an empty Lua table, schema_def.lua `vars = {type = "array"}`).
  it('a stored empty object is an empty condition list: rows, nothing held, kept as stored until the conditions are edited', async () => {
    const stored = {};
    const h = renderVars(stored);
    expect(screen.getByRole('button', { name: t('rt.vars.add') })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: t('rt.vars.json') })).not.toBeInTheDocument();
    expect(h.held()).toEqual([]);
    // As JSON, it is no held input either, and back to rows is offered.
    await h.user.click(screen.getByRole('button', { name: t('rt.vars.asJson') }));
    expect(await screen.findByRole('textbox', { name: t('rt.vars.json') })).toBeInTheDocument();
    expect(h.held()).toEqual([]);
    await h.user.click(screen.getByRole('button', { name: t('rt.vars.asRows') }));
    expect(h.changes).not.toHaveBeenCalled();
    expect(h.value()).toBe(stored);

    await addRow(h.user);
    await h.user.type(variable(1), 'arg_a');
    await h.user.type(valueBox(1), 'x');
    expect(h.value()).toEqual([['arg_a', '==', 'x']]);
  });

  it('typed as JSON, an empty object is an empty list too: nothing held, vars removed', async () => {
    const h = renderVars([['a', '==', '1']]);
    await h.user.click(screen.getByRole('button', { name: t('rt.vars.asJson') }));
    const editor = await screen.findByRole('textbox', { name: t('rt.vars.json') });
    await h.user.click(editor);
    await h.user.keyboard('{Control>}a{/Control}');
    await h.user.paste('{}');
    expect(h.held()).toEqual([]);
    expect(h.value()).toBeUndefined();
  });

  it('refuses to switch to JSON while a row holds input', async () => {
    const h = renderVars([['a', '>', 1]]);
    await h.user.clear(valueBox(1));
    await h.user.type(valueBox(1), 'x');
    await h.user.click(screen.getByRole('button', { name: t('rt.vars.asJson') }));
    expect(screen.queryByRole('textbox', { name: t('rt.vars.json') })).not.toBeInTheDocument();
    expect(valueBox(1)).toHaveValue('x');
  });
});

describe('VarsBuilder locked', () => {
  it('reads as a list of conditions, values as JSON, and says all must match', () => {
    renderVars([['arg_id', '==', '1'], ['remote_addr', '!', 'ipmatch', ['10.0.0.0/8']]], { locked: true });
    const list = screen.getByRole('list', { name: t('rt.vars.label') });
    const items = within(list).getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual([
      `arg_id=="1"(${t('rt.vars.op.==')})`,
      `remote_addr${t('rt.vars.not')} ipmatch["10.0.0.0/8"](${t('rt.vars.op.ipmatch')})`,
    ]);
    expect(screen.getByText(t('rt.vars.allMatch'))).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('no conditions read as such', () => {
    renderVars(undefined, { locked: true });
    expect(screen.getByText(t('rt.vars.none'))).toBeInTheDocument();
  });

  it('a stored empty object reads as no conditions', () => {
    renderVars({}, { locked: true });
    expect(screen.getByText(t('rt.vars.none'))).toBeInTheDocument();
  });

  it('nested groups read as JSON, not editable', async () => {
    renderVars([['OR', ['a', '==', '1'], ['b', '==', '2']]], { locked: true });
    expect(await screen.findByRole('textbox', { name: t('rt.vars.json') })).toHaveAttribute('aria-readonly', 'true');
  });

  it('a row being typed is gone once the editor locks', async () => {
    const h = renderVars([['a', '==', '1']]);
    await addRow(h.user);
    await h.user.type(valueBox(2), 'v');
    h.relock(true);
    h.relock(false);
    expect(screen.queryByRole('textbox', { name: t('rt.vars.valueN', { n: 2 }) })).not.toBeInTheDocument();
    expect(h.held()).toEqual([]);
  });
});
