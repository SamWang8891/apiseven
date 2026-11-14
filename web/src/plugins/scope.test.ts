import { describe, expect, it } from 'vitest';
import type { PluginInfo } from '../api/types';
import { pluginFixture } from '../test/pluginFixture';
import { emptyPlugins, pluginsAvailable, schemaFor, scopeOfKind, type Scope } from './scope';

const { http, stream } = pluginFixture();
const info = (name: string): PluginInfo => {
  const found = http[name];
  if (!found) throw new Error(`no ${name} in the fixture`);
  return found;
};

describe('scopeOfKind', () => {
  it('maps every plugin-bearing kind to its scope, and no other kind', () => {
    expect(scopeOfKind).toEqual({
      routes: 'route',
      services: 'service',
      consumers: 'consumer',
      consumer_groups: 'consumer_group',
      global_rules: 'global_rule',
      plugin_configs: 'plugin_config',
      stream_routes: 'stream_route',
      credentials: 'credential',
    });
  });
});

describe('schemaFor', () => {
  it('consumer and credential: the consumer_schema when the plugin has one', () => {
    for (const scope of ['consumer', 'credential'] as const) {
      expect(schemaFor(info('key-auth'), scope)).toBe(info('key-auth').consumer_schema);
      expect(schemaFor(info('limit-count'), scope)).toBe(info('limit-count').schema);
    }
  });

  it('every other scope: the route-side schema (a consumer group checks plugins as a route does)', () => {
    for (const scope of ['route', 'service', 'consumer_group', 'global_rule', 'plugin_config', 'stream_route'] as const) {
      expect(schemaFor(info('key-auth'), scope)).toBe(info('key-auth').schema);
    }
  });
});

describe('pluginsAvailable', () => {
  const httpNames = Object.keys(http).sort();

  it('route, service, consumer, consumer group, global rule, plugin config: every http plugin, sorted', () => {
    for (const scope of ['route', 'service', 'consumer', 'consumer_group', 'global_rule', 'plugin_config'] as Scope[]) {
      expect(pluginsAvailable(http, scope)).toEqual(httpNames);
    }
  });

  it('credential: only auth plugins that have a consumer schema', () => {
    const names = pluginsAvailable(http, 'credential');
    expect(names).toEqual(['basic-auth', 'hmac-auth', 'jwe-decrypt', 'jwt-auth', 'key-auth', 'ldap-auth', 'ldap-auth-advanced', 'wolf-rbac']);
    // multi-auth is an auth plugin without a consumer schema.
    expect(http['multi-auth']?.type).toBe('auth');
    expect(names).not.toContain('multi-auth');
  });

  it('stream route: the stream set it is given, sorted', () => {
    expect(pluginsAvailable(stream, 'stream_route')).toEqual(['ip-restriction', 'limit-conn', 'mqtt-proxy', 'syslog', 'traffic-split']);
  });
});

describe('emptyPlugins', () => {
  it('undefined where plugins is optional; {} where APISIX requires it', () => {
    expect(emptyPlugins('route')).toBeUndefined();
    expect(emptyPlugins('service')).toBeUndefined();
    expect(emptyPlugins('consumer')).toBeUndefined();
    expect(emptyPlugins('stream_route')).toBeUndefined();
    expect(emptyPlugins('credential')).toBeUndefined();
    expect(emptyPlugins('global_rule')).toEqual({});
    expect(emptyPlugins('plugin_config')).toEqual({});
    expect(emptyPlugins('consumer_group')).toEqual({});
  });
});
