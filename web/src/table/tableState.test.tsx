import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ColumnDef } from '../resources/registry';
import { defaultTableState, tableStorageKey, useTableState } from './tableState';

afterEach(() => localStorage.clear());

const col = (id: string, defaultVisible = true): ColumnDef => ({ id, header: id, accessor: () => id, defaultVisible });
const COLUMNS = [col('name'), col('hosts'), col('uris'), col('id', false)];

function mount(columns = COLUMNS, key = 'routes') {
  return renderHook(({ cols }) => useTableState(key, cols), { initialProps: { cols: columns } });
}

describe('useTableState', () => {
  it('starts from the defaults: definition order, defaultVisible columns, 50 rows, comfortable', () => {
    const { result } = mount();
    expect(result.current[0]).toEqual({
      visible: ['name', 'hosts', 'uris'],
      order: ['name', 'hosts', 'uris', 'id'],
      widths: {},
      sort: [],
      pageSize: 50,
      density: 'comfortable',
    });
    expect(result.current[0]).toEqual(defaultTableState(COLUMNS));
  });

  it('persists a hidden column and a new order across a remount, read back from localStorage', () => {
    const first = mount();
    act(() => first.result.current[1]({ visible: ['name', 'uris'], order: ['uris', 'name', 'hosts', 'id'] }));
    expect(first.result.current[0].visible).toEqual(['name', 'uris']);
    first.unmount();

    const stored = JSON.parse(localStorage.getItem(tableStorageKey('routes')) ?? 'null') as unknown;
    expect(stored).toMatchObject({ visible: ['name', 'uris'], order: ['uris', 'name', 'hosts', 'id'] });

    const second = mount();
    expect(second.result.current[0].visible).toEqual(['name', 'uris']);
    expect(second.result.current[0].order).toEqual(['uris', 'name', 'hosts', 'id']);
  });

  it('ignores stale column ids in storage and appends columns it has not seen', () => {
    localStorage.setItem(
      tableStorageKey('routes'),
      JSON.stringify({
        visible: ['gone', 'uris', 'name'],
        order: ['uris', 'gone', 'name', 'hosts'],
        widths: { gone: 300, name: 240 },
        sort: [{ id: 'gone', desc: false }, { id: 'name', desc: true }],
        pageSize: 100,
        density: 'compact',
      }),
    );
    const { result } = mount();
    expect(result.current[0]).toEqual({
      // `id` was never stored: it is new, appended, and hidden as it is by default.
      visible: ['uris', 'name'],
      order: ['uris', 'name', 'hosts', 'id'],
      widths: { name: 240 },
      sort: [{ id: 'name', desc: true }],
      pageSize: 100,
      density: 'compact',
    });
  });

  it('shows a new default-visible column', () => {
    localStorage.setItem(tableStorageKey('routes'), JSON.stringify({ visible: ['name'], order: ['name', 'hosts', 'uris', 'id'] }));
    const { result } = mount([...COLUMNS, col('updated')]);
    expect(result.current[0].visible).toEqual(['name', 'updated']);
    expect(result.current[0].order.at(-1)).toBe('updated');
  });

  it('falls back to the defaults for corrupt or unusable storage', () => {
    for (const raw of ['{not json', '[]', JSON.stringify({ visible: [], pageSize: 7, density: 'huge', widths: { name: -5 } })]) {
      localStorage.setItem(tableStorageKey('routes'), raw);
      const { result, unmount } = mount();
      expect(result.current[0]).toEqual(defaultTableState(COLUMNS));
      unmount();
    }
  });

  it('keeps tables apart by key', () => {
    const a = mount(COLUMNS, 'routes');
    act(() => a.result.current[1]({ density: 'compact' }));
    const b = mount(COLUMNS, 'services.routes');
    expect(b.result.current[0].density).toBe('comfortable');
    expect(localStorage.getItem(tableStorageKey('services.routes'))).toBeNull();
  });

  it('reset goes back to the defaults and forgets the stored state', () => {
    const { result } = mount();
    act(() => result.current[1]({ visible: ['hosts'], pageSize: 200, sort: [{ id: 'hosts', desc: true }] }));
    act(() => result.current[2]());
    expect(result.current[0]).toEqual(defaultTableState(COLUMNS));
    expect(localStorage.getItem(tableStorageKey('routes'))).toBeNull();
  });
});
