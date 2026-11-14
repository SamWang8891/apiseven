// Property test of the schema form's map rows (a map of integers, so MapRows is used; entryRows.ts
// rules 1–3): random short sequences of edits and of values arriving from outside, and after every
// step the value (as last sent, or as it arrived) equals what a reference of the rule says the rows make.
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { Obj } from '../api/types';
import { prng } from '../test/prng';
import { PendingProvider, type PendingEntry } from '../ui';
import { SchemaForm } from './SchemaForm';

const SCHEMA: Obj = { type: 'object', properties: { limits: { type: 'object', additionalProperties: { type: 'integer' } } } };
const KEYS = ['', 'a', 'b', 'c'] as const;
const VALUES = ['', '1', '2', '7'] as const;

type Limits = Record<string, number>;

interface Shown {
  key: string;
  value: string;
  flagged: boolean;
}

const blank = (r: { key: string; value: string }) => r.key === '' && r.value === '';
// A row in the map: a key, a value, and no flag on its key (used twice, no key, no value, carried).
const good = (r: Shown) => !r.flagged && r.key !== '' && r.value !== '';
const sameEntries = (a: Limits, b: Limits) => JSON.stringify(Object.entries(a)) === JSON.stringify(Object.entries(b));

function mount(initial: Limits) {
  let current: Obj = { limits: initial };
  let held: PendingEntry[] = [];
  const control: { set?: (v: Obj) => void } = {};
  function Harness() {
    const [value, setValue] = useState<Obj>({ limits: initial });
    useEffect(() => {
      control.set = (v) => {
        current = v;
        setValue(v);
      };
    }, []);
    return (
      <PendingProvider onChange={(entries) => (held = entries)}>
        <SchemaForm
          schema={SCHEMA}
          value={value}
          onChange={(v) => {
            current = v as Obj;
            setValue(v as Obj);
          }}
        />
      </PendingProvider>
    );
  }
  const { container } = render(<Harness />);
  return {
    container,
    limits: (): Limits => ((current.limits ?? {}) as Limits),
    held: () => held.map((e) => e.message),
    outside: (limits: Limits) => act(() => control.set?.({ limits })),
  };
}

describe('map rows send what they show (property, seeded)', () => {
  const SEEDS = 200;
  it(`${SEEDS} sequences of 8 steps over 2–4 rows: edits, and values from outside`, () => {
    let steps = 0;
    let heldSteps = 0;
    let outsideSteps = 0;
    let carriedSteps = 0;
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const r = prng(seed);
      const count = 2 + r.int(3);
      const initial: Limits = {};
      for (let i = 0; i < count; i += 1) initial[['a', 'b', 'c', 'd'][i] as string] = Number(r.pick(VALUES.slice(1)));
      const ui = mount(initial);
      const rows = () => [...ui.container.querySelectorAll<HTMLElement>('.sf-map__row')];
      const inputs = (row: HTMLElement) => [row.querySelector<HTMLInputElement>('input.ui-input:not([role])'), row.querySelector<HTMLInputElement>('input[role="spinbutton"]')] as [HTMLInputElement, HTMLInputElement];
      const shownRows = (): Shown[] =>
        rows().map((row) => {
          const [key, value] = inputs(row);
          return { key: key.value, value: value.value, flagged: key.getAttribute('aria-invalid') === 'true' };
        });
      let ids = Object.keys(initial).map((_, i) => i + 1);
      let nextId = ids.length + 1;
      const committed = new Map<number, { key: string; value: number }>(Object.entries(initial).map(([k, v], i) => [i + 1, { key: k, value: v }]));
      const carried = new Set<number>();
      const commitRow = (i: number) => {
        const row = shownRows()[i];
        const id = ids[i];
        if (row && id !== undefined && good(row)) committed.set(id, { key: row.key, value: Number(row.value) });
      };
      const log: string[] = [];

      for (let step = 0; step < 8; step += 1) {
        const n = rows().length;
        const op = r.int(7);
        const i = r.int(Math.max(1, n));
        const row = rows()[i];
        if (op === 6) {
          // A value from outside: one dropping a key a held row competes for, one adding a key a row
          // shows, or an unrelated one.
          const before = shownRows();
          const sent = Object.entries(ui.limits());
          const heldKeys = before.filter((s) => !good(s) && !blank(s) && s.key !== '').map((s) => s.key);
          const rival = sent.find(([k]) => heldKeys.includes(k));
          const shownKey = before.map((s) => s.key).find((k) => k !== '' && !sent.some(([sk]) => sk === k));
          const candidates: [string, Limits][] = [
            ['drop', Object.fromEntries(rival ? sent.filter(([k]) => k !== rival[0]) : sent.slice(1))],
            ['add', Object.fromEntries([...sent, [shownKey ?? 'zz', 9]])],
            ['other', { x: 1 }],
          ];
          const [kind, map] = r.pick(candidates);
          log.push(`outside ${kind} ${JSON.stringify(map)}`);
          const changes = !sameEntries(map, ui.limits());
          ui.outside(map);
          outsideSteps += 1;
          if (changes) {
            const entries = Object.entries(map);
            const slots: (number | undefined)[] = entries.map(() => undefined);
            const extra: number[] = [];
            before.forEach((s, j) => {
              const id = ids[j] as number;
              if (good(s) || blank(s)) return;
              const last = committed.get(id);
              const at = last ? entries.findIndex(([k, v], e) => slots[e] === undefined && k === last.key && v === last.value) : -1;
              if (at >= 0) slots[at] = id;
              else {
                extra.push(id);
                committed.delete(id);
              }
              carried.add(id);
            });
            const expectRows: Shown[] = [];
            const nextIds: number[] = [];
            entries.forEach(([k, v], e) => {
              const id = slots[e];
              if (id === undefined) {
                const fresh = nextId++;
                committed.set(fresh, { key: k, value: v });
                nextIds.push(fresh);
                expectRows.push({ key: k, value: String(v), flagged: false });
              } else {
                nextIds.push(id);
                expectRows.push({ ...(before[ids.indexOf(id)] as Shown), flagged: true });
              }
            });
            for (const id of extra) {
              nextIds.push(id);
              expectRows.push({ ...(before[ids.indexOf(id)] as Shown), flagged: true });
            }
            for (const id of ids) if (!nextIds.includes(id)) committed.delete(id);
            ids = nextIds;
            expect(shownRows(), `seed ${seed}: ${log.join(', ')} (rows after the outside change)`).toEqual(expectRows);
          }
        } else if (n === 0 || op === 4) {
          log.push('add');
          fireEvent.click(ui.container.querySelector('.sf-list__action button') as HTMLElement);
          ids = [...ids, nextId++];
        } else if (op === 0 || op === 1) {
          const k = r.pick(KEYS);
          log.push(`key ${i + 1} = "${k}"`);
          fireEvent.change(inputs(row as HTMLElement)[0], { target: { value: k } });
          carried.delete(ids[i] as number);
        } else if (op === 2) {
          const v = r.pick(VALUES);
          log.push(`value ${i + 1} = "${v}"`);
          fireEvent.change(inputs(row as HTMLElement)[1], { target: { value: v } });
          carried.delete(ids[i] as number);
        } else if (op === 3) {
          log.push(`leave ${i + 1}`);
          fireEvent.focusOut(inputs(row as HTMLElement)[0]);
          commitRow(i);
        } else {
          log.push(`remove ${i + 1}`);
          fireEvent.click(row?.querySelector('button[aria-label^="Remove"]') as HTMLElement);
          const gone = ids[i];
          if (gone !== undefined) {
            committed.delete(gone);
            carried.delete(gone);
          }
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
        shown.forEach((s, j) => {
          if (carried.has(ids[j] as number)) {
            carriedSteps += 1;
            expect(s.flagged, `${where}: carried row ${j + 1} not flagged`).toBe(true);
          }
        });
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
        const sent = ui.limits();
        expect(Object.entries(sent), where).toEqual(expected);
        if (ui.held().length === 0) {
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
    expect(outsideSteps).toBeGreaterThan(SEEDS / 2);
    expect(carriedSteps).toBeGreaterThan(SEEDS / 4);
  }, 30_000);
});
