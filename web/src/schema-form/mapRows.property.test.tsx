// Property test of the schema form's map rows (a map of integers, so MapRows is used; entryRows.ts
// rules 1–3): random short sequences of edits, and after every step the value sent equals what a
// reference of the rule says the rows make.
import { act, cleanup, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Obj } from '../api/types';
import { prng } from '../test/prng';
import { renderSchemaForm } from '../test/schemaForm';

const SCHEMA: Obj = { type: 'object', properties: { limits: { type: 'object', additionalProperties: { type: 'integer' } } } };
const KEYS = ['', 'a', 'b', 'c'] as const;
const VALUES = ['', '1', '2', '7'] as const;

interface Shown {
  key: string;
  value: string;
  flagged: boolean;
}

const blank = (r: { key: string; value: string }) => r.key === '' && r.value === '';
// A row in the map: a key, a value, and no flag on its key (used twice, no key, no value).
const good = (r: Shown) => !r.flagged && r.key !== '' && r.value !== '';

describe('map rows send what they show (property, seeded)', () => {
  const SEEDS = 200;
  it(`${SEEDS} sequences of 8 edits over 2–4 rows`, () => {
    let steps = 0;
    let heldSteps = 0;
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const r = prng(seed);
      const count = 2 + r.int(3);
      const initial: Record<string, number> = {};
      for (let i = 0; i < count; i += 1) initial[['a', 'b', 'c', 'd'][i] as string] = Number(r.pick(VALUES.slice(1)));
      const form = renderSchemaForm(SCHEMA, { limits: initial });
      const rows = () => [...form.container.querySelectorAll<HTMLElement>('.sf-map__row')];
      const inputs = (row: HTMLElement) => [row.querySelector<HTMLInputElement>('input.ui-input:not([role])'), row.querySelector<HTMLInputElement>('input[role="spinbutton"]')] as [HTMLInputElement, HTMLInputElement];
      const shownRows = (): Shown[] =>
        rows().map((row) => {
          const [key, value] = inputs(row);
          return { key: key.value, value: value.value, flagged: key.getAttribute('aria-invalid') === 'true' };
        });
      let ids = Object.keys(initial).map((_, i) => i + 1);
      let nextId = ids.length + 1;
      const committed = new Map<number, { key: string; value: number }>(Object.entries(initial).map(([k, v], i) => [i + 1, { key: k, value: v }]));
      const commitRow = (i: number) => {
        const row = shownRows()[i];
        const id = ids[i];
        if (row && id !== undefined && good(row)) committed.set(id, { key: row.key, value: Number(row.value) });
      };
      const log: string[] = [];

      for (let step = 0; step < 8; step += 1) {
        const n = rows().length;
        const op = r.int(6);
        const i = r.int(Math.max(1, n));
        const row = rows()[i];
        if (n === 0 || op === 4) {
          log.push('add');
          fireEvent.click(form.container.querySelector('.sf-list__action button') as HTMLElement);
          ids = [...ids, nextId++];
        } else if (op === 0 || op === 1) {
          const k = r.pick(KEYS);
          log.push(`key ${i + 1} = "${k}"`);
          fireEvent.change(inputs(row as HTMLElement)[0], { target: { value: k } });
        } else if (op === 2) {
          const v = r.pick(VALUES);
          log.push(`value ${i + 1} = "${v}"`);
          fireEvent.change(inputs(row as HTMLElement)[1], { target: { value: v } });
        } else if (op === 3) {
          log.push(`leave ${i + 1}`);
          fireEvent.focusOut(inputs(row as HTMLElement)[0]);
          commitRow(i);
        } else {
          log.push(`remove ${i + 1}`);
          fireEvent.click(row?.querySelector('button[aria-label^="Remove"]') as HTMLElement);
          const gone = ids[i];
          if (gone !== undefined) committed.delete(gone);
          ids = ids.filter((_, j) => j !== i);
        }
        const focused = document.activeElement;
        if (focused instanceof HTMLInputElement) {
          const at = rows().findIndex((el) => el.contains(focused));
          act(() => focused.blur());
          if (at >= 0) commitRow(at);
        }
        shownRows().forEach((shown, j) => {
          const id = ids[j];
          if (id !== undefined && blank(shown)) committed.delete(id);
        });

        const shown = shownRows();
        const where = `seed ${seed}: ${log.join(', ')}`;
        expect(shown, where).toHaveLength(ids.length);
        const goodKeys = new Set(shown.filter(good).map((s) => s.key));
        const kept = new Set<string>();
        const expected: [string, number][] = [];
        shown.forEach((s, j) => {
          if (good(s)) expected.push([s.key, Number(s.value)]);
          else if (!blank(s)) {
            const last = committed.get(ids[j] as number);
            if (last && !goodKeys.has(last.key) && !kept.has(last.key)) {
              kept.add(last.key);
              expected.push([last.key, last.value]);
            }
          }
        });
        const sent = ((form.value() as Obj).limits ?? {}) as Obj;
        expect(Object.entries(sent), where).toEqual(expected);
        if (form.held().length === 0) {
          expect(Object.entries(sent), `${where} (nothing held)`).toEqual(shown.filter((s) => !blank(s)).map((s) => [s.key, Number(s.value)]));
        } else heldSteps += 1;
        const allowed = new Set([...shown.map((s) => s.key), ...[...committed.values()].map((e) => e.key)]);
        for (const k of Object.keys(sent)) expect(allowed.has(k), `${where}: key "${k}"`).toBe(true);
        expect(Object.keys(sent).length, where).toBeLessThanOrEqual(shown.length);
        steps += 1;
      }
      cleanup();
    }
    expect(steps).toBe(SEEDS * 8);
    expect(heldSteps).toBeGreaterThan(SEEDS);
  }, 30_000);
});
