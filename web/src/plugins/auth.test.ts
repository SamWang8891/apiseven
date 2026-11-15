// Which plugins are auth plugins, which APISIX never runs when they reach a route through a consumer
// or its group (apisix/plugin.lua 612–614).
import { describe, expect, it } from 'vitest';
import { ctxOf, itemOf } from '../test/ctx';
import { pluginFixture } from '../test/pluginFixture';
import { isAuthPlugin } from './auth';
import { consumerInheritedPlugins } from './inherited';
import { AUTH_PLUGINS } from './subsystems';

describe('isAuthPlugin', () => {
  it('the generated list is exactly the plugins the dev APISIX 3.20 reports as type auth', () => {
    const { http } = pluginFixture();
    expect([...AUTH_PLUGINS].sort()).toEqual(Object.keys(http).filter((name) => http[name]?.type === 'auth').sort());
  });

  it("by the connected APISIX's plugin list once it has loaded (a custom auth plugin too); by the source's list before", () => {
    const all = { ...pluginFixture().http, 'my-auth': { schema: {}, type: 'auth' } };
    expect(isAuthPlugin('key-auth', all)).toBe(true);
    expect(isAuthPlugin('my-auth', all)).toBe(true);
    expect(isAuthPlugin('limit-count', all)).toBe(false);
    expect(isAuthPlugin('key-auth', undefined)).toBe(true);
    expect(isAuthPlugin('my-auth', undefined)).toBe(false);
  });
});

describe("a consumer's inherited plugins", () => {
  it("marks a group's auth plugin as not applied; the others apply", () => {
    const ctx = ctxOf({ consumerGroups: [itemOf('g', { plugins: { 'key-auth': {}, 'limit-count': { count: 1, time_window: 1 } } })] });
    expect(consumerInheritedPlugins({ username: 'jo', group_id: 'g' }, ctx, pluginFixture().http)).toEqual([
      { name: 'key-auth', from: 'consumer_group', disabled: false, notApplied: true },
      { name: 'limit-count', from: 'consumer_group', disabled: false },
    ]);
  });
});
