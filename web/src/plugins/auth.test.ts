// Which plugins are auth plugins, which APISIX never runs when they reach a route through a consumer
// or its group (apisix/plugin.lua 612–614).
import { describe, expect, it } from 'vitest';
import { ctxOf, itemOf } from '../test/ctx';
import { pluginFixture } from '../test/pluginFixture';
import { AUTH_SECRETS, isAuthPlugin, signsInAlways, withoutSignInSecrets } from './auth';
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

describe('sign-in plugins of consumers and credentials', () => {
  it('signsInAlways: an auth plugin of a consumer or a credential; not a non-auth one, nor an auth plugin elsewhere', () => {
    const { http } = pluginFixture();
    expect(signsInAlways('credential', 'key-auth', http['key-auth'])).toBe(true);
    expect(signsInAlways('consumer', 'basic-auth', undefined)).toBe(true);
    expect(signsInAlways('consumer', 'limit-count', http['limit-count'])).toBe(false);
    expect(signsInAlways('route', 'key-auth', http['key-auth'])).toBe(false);
    expect(signsInAlways('consumer_group', 'key-auth', http['key-auth'])).toBe(false);
  });

  it("AUTH_SECRETS is each auth plugin's consumer schema encrypt_fields in the fixture", () => {
    const { http } = pluginFixture();
    const fromFixture = Object.fromEntries(
      Object.entries(http)
        .filter(([, info]) => info.type === 'auth' && Array.isArray(info.consumer_schema?.encrypt_fields) && (info.consumer_schema.encrypt_fields as unknown[]).length > 0)
        .map(([name, info]) => [name, info.consumer_schema?.encrypt_fields]),
    );
    expect(AUTH_SECRETS).toEqual(fromFixture);
  });

  it('withoutSignInSecrets: a copy keeps everything but the auth plugins\' secrets', () => {
    const plugins = { 'key-auth': { key: 'k' }, 'jwt-auth': { key: 'id', secret: 's', algorithm: 'HS256' }, 'limit-count': { count: 1, time_window: 1, redis_password: 'r' } };
    expect(withoutSignInSecrets(plugins, pluginFixture().http)).toEqual({
      plugins: { 'key-auth': {}, 'jwt-auth': { key: 'id', algorithm: 'HS256' }, 'limit-count': { count: 1, time_window: 1, redis_password: 'r' } },
      cleared: ['jwt-auth', 'key-auth'],
    });
    expect(withoutSignInSecrets({ 'basic-auth': { username: 'u', password: 'p' } }).plugins).toEqual({ 'basic-auth': { username: 'u' } });
  });
});
