import { afterEach, describe, expect, it } from 'vitest';
import type { Kind } from '../api/types';
import { en } from '../i18n/en';
import { t } from '../i18n';
import { ctxOf, itemOf } from '../test/ctx';
import { scopeOfKind } from '../plugins/scope';
import { registry } from './registry';
import { routeColumns } from './routes/columns';
import { routeFilters } from './routes/filters';
import { hostGrouping } from './routes/grouping';
import { serviceColumns } from './services/columns';
import { serviceFilters } from './services/filters';
import { streamRouteColumns } from './stream_routes/columns';

const KINDS: Kind[] = [
  'routes', 'services', 'upstreams', 'consumers', 'credentials', 'consumer_groups', 'ssls',
  'global_rules', 'plugin_configs', 'plugin_metadata', 'protos', 'secrets', 'stream_routes',
];

describe('registry', () => {
  it('describes all 13 kinds, each under its own key', () => {
    expect(Object.keys(registry).sort()).toEqual([...KINDS].sort());
    for (const kind of KINDS) expect(registry[kind].kind).toBe(kind);
  });

  it('puts each kind in its sidebar group', () => {
    const groups = Object.fromEntries(KINDS.map((kind) => [kind, registry[kind].group]));
    expect(groups).toEqual({
      routes: 'traffic', stream_routes: 'traffic', services: 'traffic', upstreams: 'traffic',
      consumers: 'access', credentials: 'access', consumer_groups: 'access', ssls: 'access', secrets: 'access',
      global_rules: 'plugins', plugin_configs: 'plugins', plugin_metadata: 'plugins',
      protos: 'other',
    });
  });

  it('gives routes and SSLs a status, and nothing else', () => {
    expect(KINDS.filter((kind) => registry[kind].hasStatus)).toEqual(['routes', 'ssls']);
  });

  it('knows which kinds need a caller-chosen id', () => {
    const modes = Object.fromEntries(KINDS.map((kind) => [kind, registry[kind].idMode]));
    expect(modes).toEqual({
      routes: 'optional', services: 'optional', upstreams: 'optional', ssls: 'optional', protos: 'optional',
      stream_routes: 'optional',
      consumers: 'required', credentials: 'required', consumer_groups: 'required', global_rules: 'required',
      plugin_configs: 'required', secrets: 'required',
      plugin_metadata: 'fixed-list',
    });
  });

  it('starts new objects from the right blank', () => {
    expect(registry.routes.blank()).toEqual({ uri: '/*', status: 1 });
    expect(registry.ssls.blank()).toEqual({ status: 1 });
    expect(registry.upstreams.blank()).toEqual({ type: 'roundrobin', nodes: [] });
    expect(registry.global_rules.blank()).toEqual({ plugins: {} });
    expect(registry.plugin_configs.blank()).toEqual({ plugins: {} });
    for (const kind of ['services', 'consumers', 'credentials', 'secrets', 'protos', 'stream_routes'] as const) {
      expect(registry[kind].blank()).toEqual({});
    }
  });

  it('returns a fresh blank on every call', () => {
    for (const kind of KINDS) expect(registry[kind].blank()).not.toBe(registry[kind].blank());
    const first = registry.upstreams.blank();
    (first.nodes as unknown[]).push({ host: 'a', port: 1, weight: 1 });
    expect(registry.upstreams.blank()).toEqual({ type: 'roundrobin', nodes: [] });
  });

  it('names a kind with the i18n strings', () => {
    expect(registry.routes.plural).toBe(t('kind.routes.plural'));
    expect(registry.routes.singular).toBe(t('kind.routes.singular'));
    expect(registry.ssls.plural).toBe(t('kind.ssls.plural'));
  });

  it('gives routes their list columns, quick filters and the host grouping', () => {
    expect(registry.routes.columns).toBe(routeColumns);
    expect(registry.routes.filters).toBe(routeFilters);
    expect(registry.routes.groupings).toEqual([hostGrouping]);
  });

  it('gives every plugin-bearing kind the Plugins tab and the plugin checks, and the others (but the kinds with their own tabs) no tabs', () => {
    for (const kind of KINDS.filter((k) => !['upstreams', 'routes', 'services', 'stream_routes'].includes(k))) {
      const def = registry[kind];
      if (scopeOfKind[kind]) {
        expect(def.tabs.map((tab) => [tab.id, tab.label, tab.fields]), kind).toEqual([['plugins', t('pl.tab'), ['plugins']]]);
        expect(typeof def.validate, kind).toBe('function');
      } else {
        expect(def.tabs, kind).toEqual([]);
        expect(typeof def.validate, kind).toBe('undefined');
      }
    }
  });

  it('gives routes their own tabs, checks and prefill', () => {
    const def = registry.routes;
    expect(def.tabs.map((tab) => [tab.id, tab.label])).toEqual([
      ['general', t('rt.tab.general')],
      ['matching', t('rt.tab.matching')],
      ['upstream', t('rt.tab.upstream')],
      ['plugins', t('pl.tab')],
      ['advanced', t('rt.tab.advanced')],
    ]);
    // Every top-level route field is owned by exactly one tab (the frame's own: id, status, timestamps).
    const owned = def.tabs.flatMap((tab) => tab.fields);
    expect(new Set(owned).size).toBe(owned.length);
    expect(owned.sort()).toEqual(
      ['name', 'desc', 'labels', 'priority', 'host', 'hosts', 'uri', 'uris', 'methods', 'remote_addr', 'remote_addrs', 'vars', 'filter_func', 'service_id', 'upstream_id', 'upstream', 'plugins', 'plugin_config_id', 'timeout', 'enable_websocket', 'script', 'script_id'].sort(),
    );
    expect(def.prefill).toEqual(['service_id', 'upstream_id', 'plugin_config_id']);
    expect(def.validate?.({ uri: '/*', status: 1 }, { isNew: true, ctx: ctxOf() }).map((i) => [i.path, i.tab])).toEqual([['', 'upstream']]);
  });

  it('gives services their own tabs, columns, filters and checks', () => {
    const def = registry.services;
    expect(def.tabs.map((tab) => [tab.id, tab.label])).toEqual([
      ['general', t('svc.tab.general')],
      ['upstream', t('rt.tab.upstream')],
      ['plugins', t('pl.tab')],
      ['routes', t('svc.tab.routes')],
    ]);
    // Each top-level service field is owned by one tab at most (the frame's own: id, timestamps);
    // `script` has no form and badges the JSON tab; Routes owns nothing.
    const owned = def.tabs.flatMap((tab) => tab.fields);
    expect(new Set(owned).size).toBe(owned.length);
    expect(owned.sort()).toEqual(['name', 'desc', 'labels', 'hosts', 'enable_websocket', 'upstream_id', 'upstream', 'plugins'].sort());
    expect(def.tabs.find((tab) => tab.id === 'routes')?.fields).toEqual([]);
    expect(def.columns).toBe(serviceColumns);
    expect(def.filters).toBe(serviceFilters);
    expect(def.prefill).toBeUndefined();
    expect(def.validate?.({}, { isNew: true, ctx: ctxOf() })).toEqual([]);
    expect(def.validate?.({ hosts: ['bad host'] }, { isNew: true, ctx: ctxOf() }).map((i) => i.path)).toEqual(['hosts.0']);
  });

  it('gives stream routes their own tabs, columns, checks and prefill', () => {
    const def = registry.stream_routes;
    expect(def.tabs.map((tab) => [tab.id, tab.label])).toEqual([
      ['general', t('sr.tab.general')],
      ['matching', t('sr.tab.matching')],
      ['upstream', t('rt.tab.upstream')],
      ['plugins', t('pl.tab')],
      ['advanced', t('sr.tab.advanced')],
    ]);
    // Every top-level field of the stream_route schema is owned by exactly one tab (but id and the timestamps).
    const owned = def.tabs.flatMap((tab) => tab.fields);
    expect(new Set(owned).size).toBe(owned.length);
    expect(owned.sort()).toEqual(
      ['name', 'desc', 'labels', 'server_addr', 'server_port', 'remote_addr', 'sni', 'snis', 'service_id', 'upstream_id', 'upstream', 'plugins', 'protocol', 'tls_passthrough'].sort(),
    );
    expect(def.columns).toBe(streamRouteColumns);
    expect(def.prefill).toEqual(['service_id', 'upstream_id']);
    // APISIX takes a stream route with nothing in it, an upstream included.
    expect(def.validate?.({}, { isNew: true, ctx: ctxOf() })).toEqual([]);
    expect(def.validate?.({ server_port: 0 }, { isNew: true, ctx: ctxOf() }).map((i) => i.path)).toEqual(['server_port']);
  });

  it('gives upstreams their own tabs, columns and checks', () => {
    const def = registry.upstreams;
    expect(def.tabs.map((tab) => tab.id)).toEqual(['general', 'nodes', 'balancing', 'health', 'connection', 'tls']);
    expect(def.columns[0]?.id).toBe('name');
    expect(def.validate?.({ nodes: [] }, { isNew: true, ctx: ctxOf() }).map((i) => i.path)).toEqual(['nodes']);
  });

  it('starts every kind without columns of its own with an id + name column pair', () => {
    for (const kind of KINDS.filter((k) => !['routes', 'upstreams', 'services', 'stream_routes'].includes(k))) {
      const def = registry[kind];
      expect(def.columns.map((c) => [c.id, c.header, c.defaultVisible])).toEqual([
        ['id', t('column.id'), true],
        ['name', t('column.name'), true],
      ]);
      expect(def.columns[0]?.mono).toBe(true);
    }
  });

  it('names an object by name, then username, then desc, then its id', () => {
    expect(registry.routes.nameOf(itemOf('r1', { name: 'api', desc: 'd' }))).toBe('api');
    expect(registry.consumers.nameOf({ id: 'alice', value: { username: 'alice' } })).toBe('alice');
    expect(registry.routes.nameOf(itemOf('r1', { name: '', desc: 'Website pages' }))).toBe('Website pages');
    expect(registry.global_rules.nameOf(itemOf('default'))).toBe('default');
  });

  it('fills the columns from the item', () => {
    const [idCol, nameCol] = registry.protos.columns;
    const item = itemOf('s1', { name: 'web' });
    expect(idCol?.accessor(item, ctxOf())).toBe('s1');
    expect(nameCol?.accessor(item, ctxOf())).toBe('web');
  });
});

describe('registry strings', () => {
  const saved = { ...en };
  afterEach(() => {
    Object.assign(en, saved);
  });

  it('reads the language table at use, not at import', () => {
    en['kind.routes.plural'] = 'Rutas';
    en['column.name'] = 'Nombre';
    expect(registry.routes.plural).toBe('Rutas');
    expect(registry.protos.columns[1]?.header).toBe('Nombre');
    expect(registry.services.columns.find((c) => c.id === 'name')?.header).toBe('Nombre');
    expect(registry.routes.columns.find((c) => c.id === 'name')?.header).toBe('Nombre');
  });
});
