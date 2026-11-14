// Property test of the VarsBuilder rows: random short sequences of edits, and after every step the
// conditions sent equal a reference: each good row's condition as shown; a held row's last good
// condition (none once its row was blanked or removed); a blank row nothing. So with nothing held,
// the list is exactly the rows as shown, and no condition is sent twice or brought back.
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { t } from '../../i18n';
import { prng } from '../../test/prng';
import { PendingProvider, TooltipProvider, type PendingEntry } from '../../ui';
import { VarsBuilder } from './VarsBuilder';

const VARIABLES = ['', 'a', 'b', 'c'] as const;
const TEXTS = ['', '1', '2', 'x'] as const;
const [HELD_START = ''] = t('rt.vars.held.noVariable', { n: '\u0000' }).split('\u0000');
const HELD_ROW = new RegExp(`${HELD_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+):`, 'g');

function mount(initial: unknown[]) {
  // What the rows must make: the last list sent, or the value from outside if it came after.
  let sent: unknown = initial;
  let held: PendingEntry[] = [];
  const control: { set?: (v: unknown) => void } = {};
  function Harness() {
    const [value, setValue] = useState<unknown>(initial);
    useEffect(() => {
      control.set = (v) => {
        sent = v;
        setValue(v);
      };
    }, []);
    return (
      <TooltipProvider>
        <PendingProvider onChange={(entries) => (held = entries)}>
          <VarsBuilder
            value={value}
            onChange={(v) => {
              sent = v;
              setValue(v);
            }}
          />
        </PendingProvider>
      </TooltipProvider>
    );
  }
  const { container } = render(<Harness />);
  const rows = () => [...container.querySelectorAll<HTMLElement>('[data-row]')];
  return {
    container,
    rows,
    sent: (): unknown[] => (Array.isArray(sent) ? (sent as unknown[]) : []),
    outside: (v: unknown[] | undefined) => act(() => control.set?.(v)),
    heldRows: () => new Set(held.flatMap((e) => [...e.message.matchAll(HELD_ROW)].map((m) => Number(m[1]) - 1))),
    shown: () =>
      rows().map((row) => {
        const [variable, text] = [...row.querySelectorAll('input')] as [HTMLInputElement, HTMLInputElement];
        const not = row.querySelector('[role="checkbox"]')?.getAttribute('aria-checked') === 'true';
        const op = row.querySelector('[role="combobox"]')?.textContent ?? '';
        return { id: Number(row.dataset.row), variable: variable.value, text: text.value, not, op, inputs: [variable, text] as const };
      }),
  };
}

describe('VarsBuilder sends what its rows show (property, seeded)', () => {
  const SEEDS = 200;
  it(`${SEEDS} sequences of 8 edits over 1–3 rows`, () => {
    let steps = 0;
    let heldSteps = 0;
    let outsideSteps = 0;
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const r = prng(seed);
      const initial = Array.from({ length: 1 + r.int(3) }, (_, i) => (r.int(2) === 0 ? [['a', 'b', 'c'][i], '==', r.pick(['1', 'x'])] : [['a', 'b', 'c'][i], '>', 1 + r.int(2)]));
      const ui = mount(initial);
      // The reference: each row's last good condition, by row id.
      const lastGood = new Map<number, unknown[]>(ui.shown().map((row, i) => [row.id, initial[i] as unknown[]]));
      const log: string[] = [];

      for (let step = 0; step < 8; step += 1) {
        const rows = ui.shown();
        const i = r.int(Math.max(1, rows.length));
        const row = rows[i];
        const op = r.int(8);
        if (op === 7) {
          // A value from outside: one dropping a condition, one adding a copy of a condition a row
          // shows, or an unrelated one.
          const before = ui.shown();
          const held = ui.heldRows();
          const current = ui.sent();
          const shownGood = before.flatMap((s, j) =>
            held.has(j) || (s.variable === '' && s.text === '' && !s.not) ? [] : [[s.variable, ...(s.not ? ['!'] : []), s.op, s.op === '>' ? Number(s.text) : s.text]],
          );
          const candidates: [string, unknown[]][] = [
            ['drop', current.slice(1)],
            ['add', [...current, shownGood[0] ?? ['z', '==', 'q']]],
            ['other', [['a', '==', 'x']]],
          ];
          const [kind, list] = r.pick(candidates);
          log.push(`outside ${kind} ${JSON.stringify(list)}`);
          const changes = JSON.stringify(list) !== JSON.stringify(current);
          ui.outside(list.length > 0 ? list : undefined);
          outsideSteps += 1;
          if (changes) {
            // The reference of rowsFor: the list's conditions as rows, each held row in the place of
            // its last good condition when the list has it, else after them keeping none.
            const slots: (number | undefined)[] = list.map(() => undefined);
            const extra: number[] = [];
            before.forEach((s, j) => {
              if (!held.has(j)) {
                lastGood.delete(s.id);
                return;
              }
              const last = lastGood.get(s.id);
              const at = last ? list.findIndex((c, k) => slots[k] === undefined && JSON.stringify(c) === JSON.stringify(last)) : -1;
              if (at >= 0) slots[at] = s.id;
              else {
                extra.push(s.id);
                lastGood.delete(s.id);
              }
            });
            const after = ui.shown();
            const where = `seed ${seed}: ${log.join(', ')} (rows after the outside change)`;
            expect(after, where).toHaveLength(list.length + extra.length);
            list.forEach((c, k) => {
              const placed = slots[k];
              const rowAfter = after[k];
              if (placed !== undefined) expect(rowAfter?.id, where).toBe(placed);
              else if (rowAfter) lastGood.set(rowAfter.id, c as unknown[]);
            });
            extra.forEach((id, e) => expect(after[list.length + e]?.id, where).toBe(id));
          }
        } else if (!row || op === 4) {
          log.push('add');
          fireEvent.click([...ui.container.querySelectorAll('button')].find((b) => b.textContent === t('rt.vars.add')) as HTMLElement);
        } else if (op === 0) {
          const v = r.pick(VARIABLES);
          log.push(`variable ${i + 1} = "${v}"`);
          fireEvent.change(row.inputs[0], { target: { value: v } });
        } else if (op === 1 || op === 2) {
          const v = r.pick(TEXTS);
          log.push(`value ${i + 1} = "${v}"`);
          fireEvent.change(row.inputs[1], { target: { value: v } });
        } else if (op === 3) {
          log.push(`not ${i + 1}`);
          fireEvent.click(ui.rows()[i]?.querySelector('[role="checkbox"]') as HTMLElement);
        } else if (op === 5) {
          log.push(`remove ${i + 1}`);
          fireEvent.click(ui.rows()[i]?.querySelector(`[aria-label="${t('rt.vars.removeN', { n: i + 1 })}"]`) as HTMLElement);
          lastGood.delete(row.id);
        } else {
          const up = r.int(2) === 0;
          log.push(`move ${i + 1} ${up ? 'up' : 'down'}`);
          const button = ui.rows()[i]?.querySelector<HTMLButtonElement>(`[aria-label="${t(up ? 'rt.vars.upN' : 'rt.vars.downN', { n: i + 1 })}"]`);
          if (button && !button.disabled) fireEvent.click(button);
        }

        const where = `seed ${seed}: ${log.join(', ')}`;
        const held = ui.heldRows();
        const expected: unknown[] = [];
        const shownGood: unknown[] = [];
        ui.shown().forEach((s, j) => {
          const blank = s.variable === '' && s.text === '' && !s.not;
          const condition = [s.variable, ...(s.not ? ['!'] : []), s.op, s.op === '>' ? Number(s.text) : s.text];
          if (blank) lastGood.delete(s.id);
          else if (!held.has(j)) {
            lastGood.set(s.id, condition);
            expected.push(condition);
            shownGood.push(condition);
          } else {
            const last = lastGood.get(s.id);
            if (last) expected.push(last);
          }
        });
        expect(ui.sent(), where).toEqual(expected);
        if (held.size === 0) expect(ui.sent(), `${where} (nothing held)`).toEqual(shownGood);
        else heldSteps += 1;
        expect(ui.sent().length, where).toBeLessThanOrEqual(ui.rows().length);
        steps += 1;
      }
      cleanup();
    }
    expect(steps).toBe(SEEDS * 8);
    expect(heldSteps).toBeGreaterThan(SEEDS);
    expect(outsideSteps).toBeGreaterThan(SEEDS / 2);
  }, 30_000);
});
