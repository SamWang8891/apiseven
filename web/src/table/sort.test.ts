import { describe, expect, it } from 'vitest';
import type { Item } from '../api/types';
import type { ColumnDef } from '../resources/registry';
import { ctxOf, itemOf } from '../test/ctx';
import { compareValues, isEmptyValue, nextSort, sortItems } from './sort';

const column = (id: string): ColumnDef => ({ id, header: id, accessor: (item) => item.value[id], defaultVisible: true });
const columns = [column('name'), column('priority'), column('hosts')];
const ids = (list: Item[]) => list.map((i) => i.id);

describe('isEmptyValue', () => {
  it.each([undefined, null, '', []])('%j is empty', (v) => expect(isEmptyValue(v)).toBe(true));
  it.each([0, false, ' ', ['a'], {}])('%j is not', (v) => expect(isEmptyValue(v)).toBe(false));
});

describe('compareValues', () => {
  it('compares numbers numerically and strings naturally', () => {
    expect(compareValues(2, 10)).toBeLessThan(0);
    expect(compareValues('r2', 'r10')).toBeLessThan(0);
    expect(compareValues('b', 'A')).toBeGreaterThan(0);
  });

  it('compares arrays by their joined text', () => {
    expect(compareValues(['b.example'], ['a.example', 'z.example'])).toBeGreaterThan(0);
    expect(compareValues(['a', 'b'], ['a', 'c'])).toBeLessThan(0);
  });

  it('puts false before true', () => {
    expect(compareValues(false, true)).toBeLessThan(0);
  });
});

describe('sortItems', () => {
  const items = [
    itemOf('r1', { name: 'web', priority: 10 }),
    itemOf('r2', { name: 'api', priority: 2 }),
    itemOf('r3', { priority: 2 }),
    itemOf('r4', { name: 'api', priority: 10 }),
    itemOf('r5', { name: '', priority: 1 }),
    itemOf('r10', { name: 'web' }),
  ];

  it('sorts by the first rule, then the second; empties last in both directions', () => {
    const ctx = ctxOf();
    // name asc: api (r2, r4), web (r1, r10), then the empties r3, r5; ties by priority desc: r4 (10) before r2 (2),
    // r1 (10) before r10 (empty priority, last); r3 (2) before r5 (1).
    expect(ids(sortItems(items, [{ id: 'name', desc: false }, { id: 'priority', desc: true }], columns, ctx))).toEqual([
      'r4', 'r2', 'r1', 'r10', 'r3', 'r5',
    ]);
    // name desc: web, api, then the empties still last; priority asc inside: r10's empty priority stays last.
    expect(ids(sortItems(items, [{ id: 'name', desc: true }, { id: 'priority', desc: false }], columns, ctx))).toEqual([
      'r1', 'r10', 'r2', 'r4', 'r5', 'r3',
    ]);
  });

  it('keeps the given order for equal keys and without rules, and never mutates the input', () => {
    const copy = [...items];
    expect(sortItems(items, [], columns, ctxOf())).toEqual(items);
    sortItems(items, [{ id: 'priority', desc: false }], columns, ctxOf());
    expect(items).toEqual(copy);
  });

  it('ignores rules for unknown columns', () => {
    expect(ids(sortItems(items, [{ id: 'gone', desc: false }], columns, ctxOf()))).toEqual(ids(items));
  });
});

describe('nextSort', () => {
  it('cycles a plain click asc → desc → unsorted, replacing other rules', () => {
    let sort = nextSort([], 'name', false);
    expect(sort).toEqual([{ id: 'name', desc: false }]);
    sort = nextSort(sort, 'name', false);
    expect(sort).toEqual([{ id: 'name', desc: true }]);
    sort = nextSort(sort, 'name', false);
    expect(sort).toEqual([]);
    expect(nextSort([{ id: 'name', desc: true }, { id: 'hosts', desc: false }], 'hosts', false)).toEqual([{ id: 'hosts', desc: false }]);
  });

  it('shift-click adds a rule, then flips it, then removes it', () => {
    const base = [{ id: 'name', desc: false }];
    const added = nextSort(base, 'hosts', true);
    expect(added).toEqual([{ id: 'name', desc: false }, { id: 'hosts', desc: false }]);
    const flipped = nextSort(added, 'hosts', true);
    expect(flipped).toEqual([{ id: 'name', desc: false }, { id: 'hosts', desc: true }]);
    expect(nextSort(flipped, 'hosts', true)).toEqual(base);
  });
});
