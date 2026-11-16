import { describe, expect, it } from 'vitest';
import type { PluginInfo } from '../api/types';
import { pluginFixture } from '../test/pluginFixture';
import { emptyPlugins, pluginsAvailable, runsForInstance, schemaFor, scopeOfKind, type Scope } from './scope';

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

  it('route, service, consumer, consumer group, global rule, plugin config: every http plugin but those run for the whole instance, sorted', () => {
    for (const scope of ['route', 'service', 'consumer', 'consumer_group', 'global_rule', 'plugin_config'] as Scope[]) {
      expect(pluginsAvailable(http, scope)).toEqual(httpNames.filter((name) => name !== 'ai' && name !== 'inspect'));
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

// Final wave D5: plugins APISIX runs from plugin.init() for the whole instance (plugin.lua 272–273),
// with no request phase run_plugin would call for an object (plugin.lua 1463–1464): an entry of one in
// an object's plugins does nothing, on or off.
describe('runsForInstance', () => {
  it('the Admin API’s scope "global" (ai in 3.20’s list), and the built-in ones without a request phase (inspect, server-info, …)', () => {
    expect(http.ai?.scope).toBe('global');
    expect(runsForInstance('ai', http.ai)).toBe(true);
    expect(http.inspect?.scope).toBeUndefined();
    expect(runsForInstance('inspect', http.inspect)).toBe(true);
    for (const name of ['batch-requests', 'error-log-logger', 'gm', 'log-rotate', 'node-status', 'ocsp-stapling', 'server-info']) {
      expect(runsForInstance(name, undefined), name).toBe(true);
    }
    // A custom plugin the Admin API reports as global.
    expect(runsForInstance('my-reporter', { schema: {}, scope: 'global' })).toBe(true);
    for (const name of ['limit-count', 'prometheus', 'public-api', 'real-ip', 'example-plugin']) expect(runsForInstance(name, http[name]), name).toBe(false);
  });

  it('is offered in no scope', () => {
    for (const scope of ['route', 'service', 'consumer', 'consumer_group', 'global_rule', 'plugin_config', 'credential'] as Scope[]) {
      expect(pluginsAvailable(http, scope)).not.toContain('ai');
      expect(pluginsAvailable(http, scope)).not.toContain('inspect');
    }
    expect(pluginsAvailable({ ...stream, 'server-info': { schema: {} } }, 'stream_route')).not.toContain('server-info');
  });
});
