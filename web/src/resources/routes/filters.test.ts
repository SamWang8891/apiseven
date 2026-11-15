import { describe, expect, it } from 'vitest';
import type { Item } from '../../api/types';
import { t } from '../../i18n';
import { applyFilters, type FilterSelection } from '../../table/filter';
import { ctxOf, itemOf } from '../../test/ctx';
import { ANY_HOST, NO_SERVICE, routeFilters } from './filters';

const filter = (id: string) => {
  const def = routeFilters.find((f) => f.id === id);
  if (!def) throw new Error(`no filter ${id}`);
  return def;
};

const ROUTES: Item[] = [
  itemOf('r1', { name: 'one', status: 1, plugins: { cors: {} }, service_id: 's1', labels: { team: 'core', env: 'dev' } }),
  itemOf('r2', { name: 'two', status: 0, plugins: { 'key-auth': {} }, labels: { team: 'core' } }),
  itemOf('r3', { name: 'three', service_id: 's2', plugin_config_id: 'pc1' }),
  itemOf('r4', { name: 'four', plugins: { 'limit-count': {} }, service_id: 'gone', labels: { team: 'edge' } }),
];
const CTX = ctxOf({
  routes: ROUTES,
  services: [itemOf('s1', { name: 'web', plugins: { gzip: {} } }), itemOf('s2', { name: 'billing' })],
  pluginConfigs: [itemOf('pc1', { plugins: { 'response-rewrite': {} } })],
});

const names = (selection: FilterSelection) => applyFilters(ROUTES, '', routeFilters, selection, CTX).map((i) => i.value.name);

describe('routeFilters', () => {
  it('offers status, host, method, plugin, service and label chips, in that order', () => {
    expect(routeFilters.map((f) => f.id)).toEqual(['status', 'host', 'method', 'plugin', 'service', 'label']);
    expect(filter('plugin').label).toBe(t('filter.plugin'));
  });

  it('status: Enabled or Disabled, a missing status counting as enabled', () => {
    expect(filter('status').options(ROUTES, CTX).map((o) => o.label)).toEqual([t('table.status.enabled'), t('table.status.disabled')]);
    expect(names({ status: ['enabled'] })).toEqual(['one', 'three', 'four']);
    expect(names({ status: ['disabled'] })).toEqual(['two']);
    expect(names({ status: ['enabled', 'disabled'] })).toHaveLength(4);
  });

  it('plugin: every plugin that runs, inherited ones included; any selected one matches', () => {
    expect(filter('plugin').options(ROUTES, CTX).map((o) => o.value)).toEqual([
      'cors', 'gzip', 'key-auth', 'limit-count', 'response-rewrite',
    ]);
    expect(names({ plugin: ['key-auth', 'limit-count'] })).toEqual(['two', 'four']);
    expect(names({ plugin: ['gzip'] })).toEqual(['one']);
    expect(names({ plugin: ['response-rewrite'] })).toEqual(['three']);
  });

  it('service: the services in use by name, plus No service for routes without one', () => {
    expect(filter('service').options(ROUTES, CTX)).toEqual([
      { value: 's2', label: 'billing' },
      { value: 'gone', label: 'gone' },
      { value: 's1', label: 'web' },
      { value: NO_SERVICE, label: t('filter.noService') },
    ]);
    expect(names({ service: [NO_SERVICE] })).toEqual(['two']);
    expect(names({ service: ['s1', NO_SERVICE] })).toEqual(['one', 'two']);
  });

  it('service: no "No service" option when every route has one', () => {
    const bound = ROUTES.filter((r) => r.value.service_id !== undefined);
    expect(filter('service').options(bound, CTX).map((o) => o.value)).not.toContain(NO_SERVICE);
  });

  it('label: each distinct key:value pair', () => {
    expect(filter('label').options(ROUTES, CTX).map((o) => o.value)).toEqual(['env:dev', 'team:core', 'team:edge']);
    expect(names({ label: ['team:core'] })).toEqual(['one', 'two']);
    expect(names({ label: ['env:dev', 'team:edge'] })).toEqual(['one', 'four']);
  });

  it('host: the hosts each route matches, its service\'s when it sets none, plus Any host (acceptance: filter by host)', () => {
    const items = [
      itemOf('h1', { name: 'own', hosts: ['b.example', 'a.example'] }),
      itemOf('h2', { name: 'via', service_id: 'sh' }),
      itemOf('h3', { name: 'anywhere', uri: '/*' }),
    ];
    const ctx = ctxOf({ routes: items, services: [itemOf('sh', { name: 'shop', hosts: ['shop.example'] })] });
    expect(filter('host').options(items, ctx).map((o) => o.value)).toEqual(['a.example', 'b.example', 'shop.example', ANY_HOST]);
    const pick = (values: string[]) => applyFilters(items, '', routeFilters, { host: values }, ctx).map((i) => i.value.name);
    expect(pick(['a.example'])).toEqual(['own']);
    expect(pick(['shop.example'])).toEqual(['via']);
    expect(pick([ANY_HOST])).toEqual(['anywhere']);
    expect(filter('host').options(items, ctx).at(-1)?.label).toBe(t('filter.anyHost'));
  });

  it('host, while the services load: a route that takes its hosts from one is neither offered nor matched as Any host (fix round 1, R4.1)', () => {
    const items = [itemOf('h1', { name: 'own', host: 'a.example' }), itemOf('h2', { name: 'via', service_id: 'sh' }), itemOf('h3', { name: 'anywhere' })];
    const ctx = ctxOf({ routes: items, loaded: { services: false } });
    expect(filter('host').options(items, ctx).map((o) => o.value)).toEqual(['a.example', ANY_HOST]);
    const pick = (values: string[]) => applyFilters(items, '', routeFilters, { host: values }, ctx).map((i) => i.value.name);
    expect(pick([ANY_HOST])).toEqual(['anywhere']);
    expect(pick(['a.example', ANY_HOST])).toEqual(['own', 'anywhere']);
  });

  it('method: each method in use, ANY for routes that set none (acceptance: filter by method)', () => {
    const items = [itemOf('m1', { name: 'get', methods: ['GET'] }), itemOf('m2', { name: 'write', methods: ['POST', 'PUT'] }), itemOf('m3', { name: 'any' })];
    expect(filter('method').options(items, ctxOf()).map((o) => o.value)).toEqual(['ANY', 'GET', 'POST', 'PUT']);
    const pick = (values: string[]) => applyFilters(items, '', routeFilters, { method: values }, ctxOf()).map((i) => i.value.name);
    expect(pick(['PUT'])).toEqual(['write']);
    expect(pick(['GET', 'ANY'])).toEqual(['get', 'any']);
  });

  it('combines filters: each must match', () => {
    expect(names({ label: ['team:core'], status: ['enabled'] })).toEqual(['one']);
  });
});
