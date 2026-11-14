import { describe, expect, it } from 'vitest';
import type { Item } from '../api/types';
import { ctxOf, itemOf } from '../test/ctx';
import { applyFilters, matchesQuery, readSelection, writeSelection, type FilterDef } from './filter';

describe('matchesQuery', () => {
  const both = itemOf('r1', { host: 'api.example.org', plugins: { 'proxy-rewrite': { host: 'nginx.internal' } } });
  const exampleOnly = itemOf('r2', { host: 'www.example.org' });
  const nginxOnly = itemOf('r3', { name: 'NGINX status' });

  it('needs every space-separated term to match somewhere, ignoring case', () => {
    const items = [both, exampleOnly, nginxOnly];
    expect(items.filter((item) => matchesQuery(item, 'example nginx')).map((i) => i.id)).toEqual(['r1']);
    expect(items.filter((item) => matchesQuery(item, '  EXAMPLE   ')).map((i) => i.id)).toEqual(['r1', 'r2']);
    expect(items.filter((item) => matchesQuery(item, 'nginx')).map((i) => i.id)).toEqual(['r1', 'r3']);
  });

  it('matches everything for an empty query', () => {
    expect(matchesQuery(exampleOnly, '')).toBe(true);
    expect(matchesQuery(exampleOnly, '   ')).toBe(true);
  });

  it('searches the id too, even when the value does not repeat it', () => {
    const consumer: Item = { id: 'jo-ellen', value: { plugins: {} } };
    expect(matchesQuery(consumer, 'ellen')).toBe(true);
  });

  it('searches keys and nested values (JSON text)', () => {
    expect(matchesQuery(both, 'proxy-rewrite')).toBe(true);
    expect(matchesQuery(both, 'nginx.internal')).toBe(true);
  });
});

describe('applyFilters', () => {
  const status: FilterDef = {
    id: 'status',
    label: 'Status',
    options: () => [],
    matches: (item, selected) => selected.includes(item.value.status === 0 ? '0' : '1'),
  };
  const team: FilterDef = {
    id: 'team',
    label: 'Team',
    options: () => [],
    matches: (item, selected) => selected.includes(String((item.value.labels as Record<string, string> | undefined)?.team)),
  };
  const items = [
    itemOf('a', { status: 1, labels: { team: 'web' } }),
    itemOf('b', { status: 0, labels: { team: 'web' } }),
    itemOf('c', { status: 1, labels: { team: 'ops' } }),
    itemOf('d', { status: 1, labels: { team: 'data' } }),
  ];
  const ids = (list: Item[]) => list.map((i) => i.id);

  it('keeps items matching any selected option of a filter, and every filter', () => {
    expect(ids(applyFilters(items, '', [team], { team: ['web', 'ops'] }, ctxOf()))).toEqual(['a', 'b', 'c']);
    expect(ids(applyFilters(items, '', [status, team], { status: ['1'], team: ['web', 'ops'] }, ctxOf()))).toEqual(['a', 'c']);
  });

  it('ignores filters with nothing selected and selections for unknown filters', () => {
    expect(ids(applyFilters(items, '', [status], { status: [], gone: ['x'] }, ctxOf()))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('applies the query as well', () => {
    expect(ids(applyFilters(items, 'web', [status], { status: ['1'] }, ctxOf()))).toEqual(['a']);
  });
});

describe('selection in URL search params', () => {
  it('writes f.<id>=a,b and reads it back, values with commas included', () => {
    const params = new URLSearchParams('q=foo&tab=x');
    const next = writeSelection(params, { status: ['1', '0'], label: ['env:a,b', '100%'], empty: [] });
    expect(next.get('f.status')).toBe('1,0');
    expect(next.has('f.empty')).toBe(false);
    expect(next.get('q')).toBe('foo');
    expect(next.get('tab')).toBe('x');
    expect(readSelection(next)).toEqual({ status: ['1', '0'], label: ['env:a,b', '100%'] });
  });

  it('drops f.* params that are no longer selected', () => {
    const next = writeSelection(new URLSearchParams('f.status=1&f.team=web'), { status: ['0'] });
    expect(next.toString()).toBe('f.status=0');
  });
});
