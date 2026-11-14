import { afterEach, describe, expect, it } from 'vitest';
import type { Kind } from '../api/types';
import { en } from '../i18n/en';
import { t } from '../i18n';
import { ctxOf, itemOf } from '../test/ctx';
import { registry } from './registry';

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

  it('starts every kind with no tabs and an id + name column pair', () => {
    for (const kind of KINDS) {
      const def = registry[kind];
      expect(def.tabs).toEqual([]);
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
    const [idCol, nameCol] = registry.services.columns;
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
    expect(registry.routes.columns[1]?.header).toBe('Nombre');
  });
});
