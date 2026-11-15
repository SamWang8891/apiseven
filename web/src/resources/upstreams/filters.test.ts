import { describe, expect, it } from 'vitest';
import type { Item } from '../../api/types';
import { t } from '../../i18n';
import { applyFilters, type FilterSelection } from '../../table/filter';
import { ctxOf, itemOf } from '../../test/ctx';
import { upstreamFilters } from './filters';

const filter = (id: string) => {
  const def = upstreamFilters.find((f) => f.id === id);
  if (!def) throw new Error(`no filter ${id}`);
  return def;
};

const UPSTREAMS: Item[] = [
  itemOf('u1', { name: 'one', type: 'roundrobin', checks: { active: {} } }),
  itemOf('u2', { name: 'two', type: 'chash', scheme: 'https', checks: { active: {}, passive: {} } }),
  itemOf('u3', { name: 'three', scheme: 'grpc' }),
];
const CTX = ctxOf({ upstreams: UPSTREAMS, routes: [itemOf('r1', { upstream_id: 'u1' })] });
const names = (selection: FilterSelection) => applyFilters(UPSTREAMS, '', upstreamFilters, selection, CTX).map((i) => i.value.name);

describe('upstreamFilters', () => {
  it('offers type, scheme, health and usage chips', () => {
    expect(upstreamFilters.map((f) => f.id)).toEqual(['type', 'scheme', 'health', 'unused']);
  });

  it('type: the algorithms in use, unset counting as round robin', () => {
    expect(filter('type').options(UPSTREAMS, CTX)).toEqual([
      { value: 'chash', label: t('up.balance.chash') },
      { value: 'roundrobin', label: t('up.balance.roundrobin') },
    ]);
    expect(names({ type: ['roundrobin'] })).toEqual(['one', 'three']);
  });

  it('scheme: the schemes in use, unset counting as http', () => {
    expect(filter('scheme').options(UPSTREAMS, CTX).map((o) => o.value)).toEqual(['grpc', 'http', 'https']);
    expect(names({ scheme: ['http'] })).toEqual(['one']);
  });

  it('health: active, active + passive, off', () => {
    expect(names({ health: ['off'] })).toEqual(['three']);
    expect(names({ health: ['both'] })).toEqual(['two']);
    expect(names({ health: ['active', 'both'] })).toEqual(['one', 'two']);
  });

  // Task 16b item 69: an upstream is neither used nor unused until every list that can point at one has loaded.
  it('unused: while a list that can point at an upstream loads, matches neither value', () => {
    for (const list of ['routes', 'services', 'streamRoutes', 'pluginConfigs', 'consumers', 'consumerGroups'] as const) {
      const loading = { ...CTX, loaded: { ...CTX.loaded, [list]: false } };
      expect(applyFilters(UPSTREAMS, '', upstreamFilters, { unused: ['unused'] }, loading), list).toEqual([]);
      expect(applyFilters(UPSTREAMS, '', upstreamFilters, { unused: ['used'] }, loading), list).toEqual([]);
    }
  });

  it('unused: nothing points at it', () => {
    expect(filter('unused').options(UPSTREAMS, CTX).map((o) => o.label)).toEqual([t('filter.unused.yes'), t('filter.unused.no')]);
    expect(names({ unused: ['unused'] })).toEqual(['two', 'three']);
    expect(names({ unused: ['used'] })).toEqual(['one']);
  });
});
