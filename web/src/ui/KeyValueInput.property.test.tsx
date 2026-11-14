// Property test of KeyValueInput's rows (entryRows.ts rules 1–3): random short sequences of edits and
// of values arriving from outside, and after every step the map (as last sent, or as it arrived)
// equals what a reference of the rule says the rows make.
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { prng } from '../test/prng';
import { KeyValueInput, PendingProvider, type PendingEntry } from './index';

type Map = Record<string, string>;
const KEYS = ['', 'a', 'b', 'team', 'env'] as const;
const VALUES = ['', 'x', 'core', 'dev'] as const;

interface Shown {
  key: string;
  value: string;
  /** The key field is flagged (used twice, a value without a key, carried over an outside change). */
  flagged: boolean;
}

function mount(initial: Map) {
  // What the rows must make: the last map sent, or the value from outside if it came after.
  let current: Map = initial;
  let held: PendingEntry[] = [];
  const control: { set?: (map: Map) => void } = {};
  function Harness() {
    const [value, setValue] = useState(initial);
    useEffect(() => {
      control.set = (map) => {
        current = map;
        setValue(map);
      };
    }, []);
    return (
      <PendingProvider onChange={(entries) => (held = entries)}>
        <KeyValueInput
          label="Labels"
          value={value}
          onChange={(next) => {
            current = next;
            setValue(next);
          }}
        />
      </PendingProvider>
    );
  }
  const { container } = render(<Harness />);
  const rows = () => [...container.querySelectorAll<HTMLElement>('.ui-kv__row')];
  const inputs = (row: HTMLElement) => [...row.querySelectorAll('input')] as [HTMLInputElement, HTMLInputElement];
  return {
    current: () => current,
    held: () => held.map((e) => e.message),
    rows,
    inputs,
    shown: (): Shown[] =>
      rows().map((row) => {
        const [key, value] = inputs(row);
        return { key: key.value, value: value.value, flagged: key.getAttribute('aria-invalid') === 'true' };
      }),
    add: () => fireEvent.click(container.querySelector('.ui-kv__add') as HTMLElement),
    remove: (i: number) => fireEvent.click(rows()[i]?.querySelector('.ui-kv__remove') as HTMLElement),
    outside: (map: Map) => act(() => control.set?.(map)),
  };
}

const blank = (r: { key: string; value: string }) => r.key === '' && r.value === '';
const good = (r: Shown) => !r.flagged && !blank(r) && r.key !== '';
const sameEntries = (a: Map, b: Map) => JSON.stringify(Object.entries(a)) === JSON.stringify(Object.entries(b));
const [TWICE_START = '', TWICE_END = ''] = t('ui.pending.duplicateKey', { field: 'Labels', key: '\u0000' }).split('\u0000');
const usedTwice = (message: string) => message.startsWith(TWICE_START) && message.endsWith(TWICE_END);

describe('KeyValueInput sends what its rows show (property, seeded)', () => {
  const SEEDS = 300;
  it(`${SEEDS} sequences of 8 steps over 2–4 rows: edits, and values from outside`, () => {
    let steps = 0;
    let heldSteps = 0;
    let twiceSteps = 0;
    let outsideSteps = 0;
    let carriedSteps = 0;
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const r = prng(seed);
      const keys = ['a', 'b', 'team', 'env'];
      const count = 2 + r.int(3);
      const initial: Map = {};
      for (let i = 0; i < count; i += 1) initial[keys[i] as string] = r.pick(VALUES.slice(1));
      const ui = mount(initial);
      // The reference: each row (by a test-side id), the entry it committed, and which are carried.
      let ids = Object.keys(initial).map((_, i) => i + 1);
      let nextId = ids.length + 1;
      const committed = new Map<number, { key: string; value: string }>(Object.entries(initial).map(([k, v], i) => [i + 1, { key: k, value: v }]));
      const carried = new Set<number>();
      const log: string[] = [];
      const commitRow = (i: number) => {
        const row = ui.shown()[i];
        const id = ids[i];
        if (row && id !== undefined && good(row)) committed.set(id, { key: row.key, value: row.value });
      };

      for (let step = 0; step < 8; step += 1) {
        const n = ui.rows().length;
        const i = r.int(n);
        const op = r.int(7);
        const [keyBox, valueBox] = ui.inputs(ui.rows()[i] as HTMLElement);
        if (op === 0 || op === 1) {
          const k = r.pick(KEYS);
          log.push(`key ${i + 1} = "${k}"`);
          fireEvent.change(keyBox, { target: { value: k } });
          carried.delete(ids[i] as number);
        } else if (op === 2) {
          const v = r.pick(VALUES);
          log.push(`value ${i + 1} = "${v}"`);
          fireEvent.change(valueBox, { target: { value: v } });
          carried.delete(ids[i] as number);
        } else if (op === 3) {
          log.push(`leave ${i + 1}`);
          fireEvent.focusOut(keyBox);
          commitRow(i);
        } else if (op === 4) {
          log.push('add');
          ui.add();
          ids = [...ids, nextId++];
        } else if (op === 5) {
          log.push(`remove ${i + 1}`);
          ui.remove(i);
          const gone = ids[i];
          if (gone !== undefined) {
            committed.delete(gone);
            carried.delete(gone);
          }
          ids = ids.filter((_, j) => j !== i);
          // The last row is never removed: a blank one takes its place.
          if (ids.length === 0) ids = [nextId++];
        } else {
          // A value from outside: one dropping a key a held row competes for, one adding a key a row
          // shows, or an unrelated one.
          const before = ui.shown();
          const sent = Object.entries(ui.current());
          const heldKeys = before.filter((s) => !good(s) && !blank(s) && s.key !== '').map((s) => s.key);
          const rival = sent.find(([k]) => heldKeys.includes(k));
          const shownKey = before.map((s) => s.key).find((k) => k !== '' && !sent.some(([sk]) => sk === k));
          const candidates: [string, Map][] = [
            ['drop', Object.fromEntries(rival ? sent.filter(([k]) => k !== rival[0]) : sent.slice(1))],
            ['add', Object.fromEntries([...sent, [shownKey ?? 'zz', 'new']])],
            ['other', { x: '1' }],
          ];
          const [kind, map] = r.pick(candidates);
          log.push(`outside ${kind} ${JSON.stringify(map)}`);
          const changes = !sameEntries(map, ui.current());
          ui.outside(map);
          outsideSteps += 1;
          if (changes) {
            // The reference of keepHeldRows: the map's entries, each held row in the place of its
            // committed entry when the map has it as it was, else after them; all of them carried.
            const slots: (number | undefined)[] = Object.keys(map).map(() => undefined);
            const extra: number[] = [];
            const entries = Object.entries(map);
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
                expectRows.push({ key: k, value: v, flagged: false });
              } else {
                const was = before[ids.indexOf(id)] as Shown;
                nextIds.push(id);
                expectRows.push({ ...was, flagged: true });
              }
            });
            for (const id of extra) {
              const was = before[ids.indexOf(id)] as Shown;
              nextIds.push(id);
              expectRows.push({ ...was, flagged: true });
            }
            // Gone rows (good ones replaced by the map's entries) forget what they committed.
            for (const id of ids) if (!nextIds.includes(id)) committed.delete(id);
            ids = nextIds.length > 0 ? nextIds : [nextId++];
            if (nextIds.length > 0) expect(ui.shown(), `seed ${seed}: ${log.join(', ')} (rows after the outside change)`).toEqual(expectRows);
          }
        }
        // Whatever took focus (a new row's key) is left again, as a click elsewhere would.
        const focused = document.activeElement;
        if (focused instanceof HTMLInputElement) {
          const at = ui.rows().findIndex((row) => row.contains(focused));
          act(() => focused.blur());
          if (at >= 0) commitRow(at);
        }
        // A row emptied completely forgets its entry.
        ui.shown().forEach((row, j) => {
          const id = ids[j];
          if (id !== undefined && blank(row)) committed.delete(id);
        });

        const shown = ui.shown();
        const where = `seed ${seed}: ${log.join(', ')}`;
        expect(shown, where).toHaveLength(ids.length);
        // A carried row is held (flagged) until it is edited.
        shown.forEach((row, j) => {
          if (carried.has(ids[j] as number)) {
            carriedSteps += 1;
            expect(row.flagged, `${where}: carried row ${j + 1} not flagged`).toBe(true);
          }
        });
        // Rule 3, as a reference: good rows as shown; a held row's committed entry unless a good row shows that key.
        const goodKeys = new Set(shown.filter(good).map((row) => row.key));
        const kept = new Set<string>();
        const expected: [string, string][] = [];
        shown.forEach((row, j) => {
          if (good(row)) expected.push([row.key, row.value]);
          else if (!blank(row)) {
            const last = committed.get(ids[j] as number);
            if (last && !goodKeys.has(last.key) && !kept.has(last.key)) {
              kept.add(last.key);
              expected.push([last.key, last.value]);
            }
          }
        });
        expect(Object.entries(ui.current()), where).toEqual(expected);
        // The properties as the controller states them.
        if (ui.held().length === 0) {
          expect(Object.entries(ui.current()), `${where} (nothing held)`).toEqual(shown.filter((row) => !blank(row)).map((row) => [row.key, row.value]));
        } else heldSteps += 1;
        const allowed = new Set([...shown.map((row) => row.key), ...[...committed.values()].map((e) => e.key)]);
        for (const k of Object.keys(ui.current())) expect(allowed.has(k), `${where}: key "${k}"`).toBe(true);
        expect(Object.keys(ui.current()).length, where).toBeLessThanOrEqual(shown.length);
        // "Used twice" only while the keys shown are not unique.
        if (ui.held().flatMap((m) => m.split('; ')).some(usedTwice)) {
          twiceSteps += 1;
          const nonEmpty = shown.map((row) => row.key).filter((k) => k !== '');
          expect(new Set(nonEmpty).size, `${where}: used twice with unique keys`).toBeLessThan(nonEmpty.length);
        }
        steps += 1;
      }
      cleanup();
    }
    expect(steps).toBe(SEEDS * 8);
    // The sequences reach the cases that matter: held rows, keys used twice, outside changes, carried rows.
    expect(heldSteps).toBeGreaterThan(SEEDS);
    expect(twiceSteps).toBeGreaterThan(SEEDS / 4);
    expect(outsideSteps).toBeGreaterThan(SEEDS);
    expect(carriedSteps).toBeGreaterThan(SEEDS / 4);
  }, 30_000);
});
