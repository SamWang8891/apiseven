import { describe, expect, it } from 'vitest';
import { MASK } from '../schema/secrets';
import { pluginFixture } from '../test/pluginFixture';
import { redactObject } from './secrets';

const all = () => pluginFixture().http;

describe('redactObject: what a locked view of a whole object shows', () => {
  it("masks each plugin's encrypt_fields as its scope's schema lists them (a consumer's key-auth key)", () => {
    const consumer = { username: 'jo', desc: 'Jo', plugins: { 'key-auth': { key: 'jo-key' }, 'limit-count': { count: 2, time_window: 60 } } };
    const out = redactObject(consumer, 'consumers', all());
    expect(out.redacted).toBe(true);
    expect(out.value).toEqual({ username: 'jo', desc: 'Jo', plugins: { 'key-auth': { key: MASK }, 'limit-count': { count: 2, time_window: 60 } } });
    expect(JSON.stringify(out.value)).not.toContain('jo-key');
  });

  it.each([
    ['basic-auth', { username: 'u1', password: 'pw' }, { username: 'u1', password: MASK }],
    ['jwt-auth', { key: 'jwt-id', secret: 's3' }, { key: 'jwt-id', secret: MASK }],
    ['hmac-auth', { key_id: 'kid', secret_key: 'sk' }, { key_id: 'kid', secret_key: MASK }],
  ])("a credential's %s: its secret is masked, its identifier is not", (name, conf, shown) => {
    expect(redactObject({ id: 'c1', plugins: { [name]: conf } }, 'credentials', all()).value).toEqual({ id: 'c1', plugins: { [name]: shown } });
  });

  it('masks secret-named keys anywhere, also outside plugins and in a plugin this APISIX does not know', () => {
    const value = { plugins: { 'my-plugin': { client_secret: 'x', host: 'h' } }, labels: { a: 'b' } };
    expect(redactObject(value, 'routes', all()).value).toEqual({ plugins: { 'my-plugin': { client_secret: MASK, host: 'h' } }, labels: { a: 'b' } });
  });

  it('until the plugin list has loaded, every text inside plugins is masked (which are secret is not known yet)', () => {
    const out = redactObject({ username: 'jo', plugins: { 'key-auth': { key: 'jo-key' }, cors: { allow_origins: '*', max_age: 5 } } }, 'consumers', undefined);
    expect(out.value).toEqual({ username: 'jo', plugins: { 'key-auth': { key: MASK }, cors: { allow_origins: MASK, max_age: 5 } } });
    expect(out.redacted).toBe(true);
  });

  it('leaves an object without secrets as it is, and says nothing was masked', () => {
    const value = { id: 'g', plugins: { 'limit-count': { count: 1, time_window: 1 } } };
    const out = redactObject(value, 'consumer_groups', all());
    expect(out).toEqual({ value, redacted: false });
  });
});
