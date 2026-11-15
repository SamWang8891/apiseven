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
import { consumerColumns } from './consumers/columns';
import { consumerFilters } from './consumers/filters';
import { credentialColumns } from './credentials/columns';
import { consumerGroupColumns } from './consumer_groups/columns';
import { sslColumns } from './ssls/columns';
import { sslFilters } from './ssls/filters';

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
    // APISIX requires `plugins` in a consumer group (schema_def.lua: required = {"id", "plugins"}).
    expect(registry.consumer_groups.blank()).toEqual({ plugins: {} });
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

  it('gives every kind a form of its own: at least one tab besides JSON, and its checks', () => {
    for (const kind of KINDS) {
      const def = registry[kind];
      expect(def.tabs.length, kind).toBeGreaterThan(0);
      expect(def.tabs.map((tab) => tab.id), kind).not.toContain('json');
      expect(typeof def.validate, kind).toBe('function');
      // Every plugin-bearing kind has a Plugins tab that owns `plugins`.
      if (scopeOfKind[kind]) expect(def.tabs.find((tab) => tab.id === 'plugins')?.fields, kind).toContain('plugins');
    }
  });

  it('gives the Task 15 kinds their tabs, and the frame extension points only where they belong', () => {
    const tabs = (kind: Kind) => registry[kind].tabs.map((tab) => [tab.id, tab.fields, tab.restFields ?? false]);
    expect(tabs('global_rules')).toEqual([['plugins', ['plugins'], false]]);
    expect(tabs('plugin_configs')).toEqual([
      ['general', ['name', 'desc', 'labels'], false],
      ['plugins', ['plugins'], false],
      ['used_by', [], false],
    ]);
    expect(tabs('plugin_metadata')).toEqual([['config', [], true]]);
    expect(tabs('protos')).toEqual([
      ['general', ['name', 'desc', 'labels'], false],
      ['content', ['content'], false],
    ]);
    expect(tabs('secrets')).toEqual([['config', [], true]]);
    expect(KINDS.filter((kind) => registry[kind].NewId)).toEqual(['plugin_metadata', 'secrets']);
    expect(KINDS.filter((kind) => registry[kind].ListComponent)).toEqual(['plugin_metadata']);
    expect(KINDS.filter((kind) => registry[kind].createWhenMissing)).toEqual(['plugin_metadata']);
    expect(KINDS.filter((kind) => registry[kind].noDuplicate)).toEqual(['plugin_metadata']);
    expect(KINDS.filter((kind) => registry[kind].resets)).toEqual(['plugin_metadata']);
    expect(KINDS.filter((kind) => registry[kind].masksSearch).sort()).toEqual(['global_rules', 'plugin_configs', 'plugin_metadata', 'secrets']);
    expect(registry.secrets.idProblem?.('vault/a')).toBeUndefined();
    expect(registry.secrets.idProblem?.('vault/a/b')).toBe(t('sc.id.slash', { id: 'a/b' }));
    expect(registry.plugin_metadata.idProblem?.('http-logger')).toBeUndefined();
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

  it('gives consumers their own tabs, columns, filters, checks, id and prefill', () => {
    const def = registry.consumers;
    expect(def.tabs.map((tab) => [tab.id, tab.label, tab.fields, tab.requires])).toEqual([
      ['general', t('cs.tab.general'), ['username', 'desc', 'labels', 'group_id'], undefined],
      ['plugins', t('pl.tab'), ['plugins'], undefined],
      ['credentials', t('cs.tab.credentials'), [], 'credentials'],
    ]);
    expect(def.columns).toBe(consumerColumns);
    expect(def.filters).toBe(consumerFilters);
    expect(def.prefill).toEqual(['group_id']);
    expect(def.idFromDraft?.({ username: 'jo' })).toBe('jo');
    expect(def.idFromDraft?.({})).toBeUndefined();
    expect(def.validate?.({}, { isNew: true, ctx: ctxOf() }).map((i) => i.path)).toEqual(['username']);
    expect(def.validate?.({ username: 'jo' }, { isNew: true, ctx: ctxOf() })).toEqual([]);
  });

  it('gives credentials and consumer groups their own tabs, columns and checks', () => {
    expect(registry.credentials.tabs.map((tab) => [tab.id, tab.fields])).toEqual([
      ['general', ['name', 'desc', 'labels']],
      ['plugins', ['plugins']],
    ]);
    expect(registry.credentials.columns).toBe(credentialColumns);
    expect(registry.credentials.validate?.({ plugins: { a: {}, b: {} } }, { isNew: true, ctx: ctxOf() }).map((i) => i.path)).toEqual(['plugins']);
    expect(registry.consumer_groups.tabs.map((tab) => [tab.id, tab.fields])).toEqual([
      ['general', ['name', 'desc', 'labels']],
      ['plugins', ['plugins']],
      ['members', []],
    ]);
    expect(registry.consumer_groups.columns).toBe(consumerGroupColumns);
    expect(registry.consumer_groups.validate?.({}, { isNew: true, ctx: ctxOf() }).map((i) => i.path)).toEqual(['plugins']);
    expect(registry.consumer_groups.validate?.({ plugins: {} }, { isNew: true, ctx: ctxOf() })).toEqual([]);
  });

  it('gives SSLs their own tabs, columns, filters, checks, name and status rule', () => {
    const def = registry.ssls;
    expect(def.tabs.map((tab) => [tab.id, tab.fields])).toEqual([
      ['certificate', ['cert', 'key', 'certs', 'keys']],
      ['snis', ['sni', 'snis']],
      ['client', ['client']],
      ['general', ['type', 'desc', 'labels', 'ssl_protocols']],
    ]);
    expect(def.columns).toBe(sslColumns);
    expect(def.filters).toBe(sslFilters);
    expect(def.validate?.({}, { isNew: true, ctx: ctxOf() }).map((i) => i.path)).toEqual(['cert', 'key', 'snis']);
    expect(def.nameOf(itemOf('s1', { snis: ['b.test', 'a.test'] }))).toBe('b.test');
    expect(def.statusIgnored?.({ type: 'client' })).toBe(t('ssl.status.ignored'));
    expect(def.statusIgnored?.({})).toBeUndefined();
    // Only SSLs have a status rule of their own.
    expect(KINDS.filter((kind) => registry[kind].statusIgnored !== undefined)).toEqual(['ssls']);
  });

  it('gives upstreams their own tabs, columns and checks', () => {
    const def = registry.upstreams;
    expect(def.tabs.map((tab) => tab.id)).toEqual(['general', 'nodes', 'balancing', 'health', 'connection', 'tls']);
    expect(def.columns[0]?.id).toBe('name');
    // APISIX stores an upstream with an empty node list (Ruling 1); one with no node list nor discovery it refuses.
    expect(def.validate?.({ nodes: [] }, { isNew: true, ctx: ctxOf() })).toEqual([]);
    expect(def.validate?.({}, { isNew: true, ctx: ctxOf() }).map((i) => i.path)).toEqual(['nodes']);
  });

  it('gives every kind list columns of its own, with an `updated` column wherever APISIX stamps update_time (all but plugin metadata)', () => {
    for (const kind of KINDS) {
      const ids = registry[kind].columns.map((c) => c.id);
      expect(ids, kind).not.toEqual(['id', 'name']);
      // admin/resource.lua 315–322: plugin metadata is written without inject_conf_with_prev_conf, so without timestamps.
      if (kind === 'plugin_metadata') expect(ids, kind).not.toContain('updated');
      else expect(registry[kind].columns.find((c) => c.id === 'updated')?.defaultVisible, kind).toBe(true);
    }
  });

  it('names an object by name, then username, then desc, then its id', () => {
    expect(registry.routes.nameOf(itemOf('r1', { name: 'api', desc: 'd' }))).toBe('api');
    expect(registry.consumers.nameOf({ id: 'alice', value: { username: 'alice' } })).toBe('alice');
    expect(registry.routes.nameOf(itemOf('r1', { name: '', desc: 'Website pages' }))).toBe('Website pages');
    expect(registry.global_rules.nameOf(itemOf('default'))).toBe('default');
  });

  it('fills the columns from the item', () => {
    const [nameCol, idCol] = registry.protos.columns;
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
    expect(registry.protos.columns.find((c) => c.id === 'name')?.header).toBe('Nombre');
    expect(registry.services.columns.find((c) => c.id === 'name')?.header).toBe('Nombre');
    expect(registry.routes.columns.find((c) => c.id === 'name')?.header).toBe('Nombre');
  });
});
