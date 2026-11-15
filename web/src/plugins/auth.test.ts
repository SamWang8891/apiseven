// Which plugins are auth plugins, which APISIX never runs when they reach a route through a consumer
// or its group (apisix/plugin.lua 612–614).
import { describe, expect, it } from 'vitest';
import { ctxOf, itemOf } from '../test/ctx';
import { pluginFixture } from '../test/pluginFixture';
import { AUTH_SECRETS, isAuthPlugin, sharedSignInFields, SIGN_IN_FIELD, signInOf, signInRole, withoutSignInSecrets } from './auth';
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
  it("signInRole: an auth plugin of a consumer or credential signs in; one the loaded list doesn't know is not used; one not built in, before the list loads, is unknown", () => {
    const { http } = pluginFixture();
    expect(signInRole('credential', 'key-auth', http['key-auth'], true)).toBe('signIn');
    expect(signInRole('consumer', 'basic-auth', undefined, false)).toBe('signIn');
    expect(signInRole('consumer', 'limit-count', http['limit-count'], true)).toBeUndefined();
    expect(signInRole('route', 'key-auth', http['key-auth'], true)).toBeUndefined();
    expect(signInRole('consumer_group', 'key-auth', http['key-auth'], true)).toBeUndefined();
    // plugin_consumer skips a plugin plugin.get doesn't know (consumer.lua 166–167).
    expect(signInRole('credential', 'gone-auth', undefined, true)).toBe('unused');
    expect(signInRole('consumer', 'gone-auth', undefined, true)).toBe('unused');
    // Before the list loads, nothing definite about a plugin that isn't built in.
    expect(signInRole('credential', 'my-auth', undefined, false)).toBe('unknown');
    expect(signInRole('consumer', 'my-auth', undefined, false)).toBe('unknown');
    expect(signInRole('credential', 'my-auth', { schema: {}, type: 'auth' }, true)).toBe('signIn');
    expect(signInRole('credential', 'limit-count', http['limit-count'], true)).toBeUndefined();
  });

  it("SIGN_IN_FIELD: each is a required property of the plugin's consumer schema in the fixture; every auth plugin but multi-auth (no consumer schema) has one", () => {
    const { http } = pluginFixture();
    for (const [name, field] of Object.entries(SIGN_IN_FIELD)) {
      const schema = http[name]?.consumer_schema;
      expect(Object.keys(schema?.properties ?? {}), name).toContain(field);
      expect(schema?.required, name).toContain(field);
    }
    expect(Object.keys(SIGN_IN_FIELD).sort()).toEqual(AUTH_PLUGINS.filter((name) => name !== 'multi-auth').sort());
    expect(http['multi-auth']?.consumer_schema).toBeUndefined();
  });

  it('signInOf: marked off, it still signs in with what it is found by and checked against; without either it signs nobody in; with no known lookup field, only that off is ignored', () => {
    const off = { _meta: { disable: true } };
    expect(signInOf('key-auth', { key: 'k', ...off })).toEqual({ state: 'stillSignsIn', field: 'key' });
    expect(signInOf('key-auth', off)).toEqual({ state: 'signsNobodyIn', field: 'key', missing: 'key' });
    expect(signInOf('basic-auth', { username: 'u', password: 'p' })).toEqual({ state: 'on', field: 'username' });
    // Found by its lookup field, then checked against its secret: without the secret nobody passes.
    expect(signInOf('basic-auth', { username: 'u', ...off })).toEqual({ state: 'signsNobodyIn', field: 'username', missing: 'password' });
    expect(signInOf('hmac-auth', { key_id: 'i', secret_key: 's', ...off })).toEqual({ state: 'stillSignsIn', field: 'key_id' });
    expect(signInOf('hmac-auth', { key_id: 'i', ...off })).toEqual({ state: 'signsNobodyIn', field: 'key_id', missing: 'secret_key' });
    // jwt-auth checks an HS token against its secret (the default), any other against its public_key (get_auth_secret).
    expect(signInOf('jwt-auth', { key: 'k', secret: 's', ...off })).toEqual({ state: 'stillSignsIn', field: 'key' });
    expect(signInOf('jwt-auth', { key: 'k', algorithm: 'RS256', public_key: 'P', ...off })).toEqual({ state: 'stillSignsIn', field: 'key' });
    expect(signInOf('jwt-auth', { key: 'k', algorithm: 'RS256', secret: 's', ...off })).toEqual({ state: 'signsNobodyIn', field: 'key', missing: 'public_key' });
    expect(signInOf('jwe-decrypt', { key: 'k', ...off })).toEqual({ state: 'signsNobodyIn', field: 'key', missing: 'secret' });
    // Checked by their servers: the lookup field is all.
    expect(signInOf('ldap-auth', { user_dn: 'cn=a', ...off })).toEqual({ state: 'stillSignsIn', field: 'user_dn' });
    expect(signInOf('wolf-rbac', {})).toEqual({ state: 'on', field: 'appid' });
    expect(signInOf('multi-auth', off)).toEqual({ state: 'offIgnored' });
    expect(signInOf('my-auth', { token: 't', ...off })).toEqual({ state: 'offIgnored' });
  });

  it('sharedSignInFields: the lookup fields a copy still holds', () => {
    expect(sharedSignInFields({ 'jwt-auth': { key: 'k' }, 'basic-auth': { username: 'u' }, 'key-auth': {}, 'limit-count': { count: 1 } })).toEqual([
      { plugin: 'basic-auth', field: 'username' },
      { plugin: 'jwt-auth', field: 'key' },
    ]);
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

  it('withoutSignInSecrets: a copy keeps everything but the auth plugins\' secrets, and says exactly what it removed', () => {
    const plugins = { 'key-auth': { key: 'k' }, 'jwt-auth': { key: 'id', secret: 's', algorithm: 'HS256' }, 'limit-count': { count: 1, time_window: 1, redis_password: 'r' } };
    expect(withoutSignInSecrets(plugins, pluginFixture().http)).toEqual({
      plugins: { 'key-auth': {}, 'jwt-auth': { key: 'id', algorithm: 'HS256' }, 'limit-count': { count: 1, time_window: 1, redis_password: 'r' } },
      removed: [
        { plugin: 'jwt-auth', fields: ['secret'] },
        { plugin: 'key-auth', fields: ['key'] },
      ],
    });
  });

  it.each(AUTH_PLUGINS)("%s (one of the built-in nine): nothing of its sign-in secret stays", (name) => {
    const { http } = pluginFixture();
    const conf = { key: 'K1', secret: 'S1', password: 'P1', secret_key: 'SK1', username: 'u', key_id: 'kid', user_dn: 'cn=u', appid: 'a' };
    const out = withoutSignInSecrets({ [name]: conf }, http);
    const kept = JSON.stringify(out.plugins);
    for (const field of (http[name]?.consumer_schema?.encrypt_fields as string[] | undefined) ?? []) expect(kept, field).not.toContain(conf[field as keyof typeof conf]);
    expect(kept).not.toMatch(/S1|P1|SK1/);
    expect(out.removed.length).toBe(1);
  });

  it("an auth plugin whose secret fields aren't known (a custom one without encrypt_fields): its whole config is left out", () => {
    const all = { ...pluginFixture().http, 'my-auth': { schema: {}, type: 'auth', consumer_schema: { type: 'object' } } };
    expect(withoutSignInSecrets({ 'my-auth': { key: 'SEKRET-1' } }, all)).toEqual({ plugins: { 'my-auth': {} }, removed: [{ plugin: 'my-auth', why: 'noSecretFields' }] });
  });

  it('a nested encrypt_fields path, through a list, is cleared at any depth', () => {
    const all = { ...pluginFixture().http, 'my-auth': { schema: {}, type: 'auth', consumer_schema: { type: 'object', encrypt_fields: ['auth.token', 'keys.secret'] } } };
    const conf = { auth: { token: 'T1', header: 'X-Key' }, keys: [{ id: 'a', secret: 'S1' }, { id: 'b', secret: 'S2' }] };
    expect(withoutSignInSecrets({ 'my-auth': conf }, all)).toEqual({
      plugins: { 'my-auth': { auth: { header: 'X-Key' }, keys: [{ id: 'a' }, { id: 'b' }] } },
      removed: [{ plugin: 'my-auth', fields: ['auth.token', 'keys.secret'] }],
    });
  });

  it('the plugin list failed to load: fail closed. A built-in auth plugin loses its known secret; one not built in is left out whole; a built-in non-auth one is kept', () => {
    const plugins = { 'key-auth': { key: 'k' }, 'my-auth': { key: 'SEKRET-1' }, 'limit-count': { count: 1, time_window: 1 } };
    expect(withoutSignInSecrets(plugins, null)).toEqual({
      plugins: { 'key-auth': {}, 'my-auth': {}, 'limit-count': { count: 1, time_window: 1 } },
      removed: [
        { plugin: 'key-auth', fields: ['key'] },
        { plugin: 'my-auth', why: 'unloaded' },
      ],
    });
  });

  it('a plugin the loaded list does not know is left out whole (whether it signs in is unknown)', () => {
    expect(withoutSignInSecrets({ 'gone-auth': { token: 'x' } }, pluginFixture().http)).toEqual({ plugins: { 'gone-auth': {} }, removed: [{ plugin: 'gone-auth', why: 'unknown' }] });
  });
});
