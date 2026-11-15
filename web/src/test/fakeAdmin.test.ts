// The fake Admin API is at least as strict as APISIX 3.20 where the editors depend on it: every page
// test trusts what it accepts and what it answers.
import { describe, expect, it } from 'vitest';
import type { Obj } from '../api/types';
import { fakeAdmin } from './fakeAdmin';

const base = 'http://apisix.test:9180/apisix/admin';

function setup(objects: Record<string, Obj[]> = {}) {
  const admin = fakeAdmin({ counts: {}, objects });
  const call = async (method: string, path: string, body?: Obj) => {
    const res = await admin.fetch(`${base}/${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as Obj };
  };
  return { admin, call };
}

describe('fakeAdmin', () => {
  it('stamps create_time and update_time on every write, keeps create_time on a replace, and returns them', async () => {
    const { call } = setup({ routes: [] });
    const created = await call('PUT', 'routes/r1', { uri: '/a' });
    const value = created.body.value as Obj;
    expect(value.create_time).toEqual(expect.any(Number));
    expect(value.update_time).toEqual(value.create_time);
    await call('PUT', 'routes/r1', { uri: '/b' });
    const read = (await call('GET', 'routes/r1')).body.value as Obj;
    expect(read.create_time).toBe(value.create_time);
    expect(read.update_time).toBeGreaterThan(value.update_time as number);
  });

  it.each([
    [{ uri: '/a', create_time: 1 }, 'create_time'],
    [{ uri: '/a', update_time: 1 }, 'update_time'],
    [{ uri: '/a', upstream: { nodes: [], create_time: 1 } }, 'upstream.create_time'],
    [{ uri: '/a', plugins: { update_time: 1 } }, 'plugins.update_time'],
  ])('refuses a POST or PUT that carries a timestamp, as APISIX does: %j', async (body, field) => {
    const { call } = setup({ routes: [] });
    expect(await call('PUT', 'routes/r1', body)).toEqual({ status: 400, body: { error_msg: `the property is forbidden:  ${field}` } });
    expect((await call('POST', 'routes', body)).status).toBe(400);
  });

  it("echoes every encrypt_fields path from the fixture as ciphertext: nested, in a map, in a list of objects; GET returns them clear", async () => {
    const { call } = setup({ routes: [] });
    const plugins = {
      'ai-proxy': { provider: 'openai', auth: { header: { Authorization: 'Bearer a' } } },
      'kafka-logger': { brokers: [{ host: 'k', port: 9092, sasl_config: { user: 'u', password: 'p1' } }], kafka_topic: 't' },
      'limit-count': { count: 1, time_window: 1, redis_password: 'r' },
    };
    const echo = (await call('PUT', 'routes/r1', { uri: '/a', plugins })).body.value as { plugins: Record<string, Obj> };
    const text = JSON.stringify(echo.plugins);
    expect(text).not.toMatch(/Bearer a|"p1"|"r"/);
    expect(((echo.plugins['ai-proxy']?.auth as Obj).header as Obj).Authorization).toMatch(/^\$ENC\$v1\$/);
    expect((echo.plugins['kafka-logger']?.brokers as Obj[])[0]?.sasl_config).toEqual({ user: 'u', password: expect.stringMatching(/^\$ENC\$v1\$/) as string });
    expect((await call('GET', 'routes/r1')).body.value).toMatchObject({ plugins });
  });

  it("a consumer's and a credential's plugins by their consumer schema", async () => {
    const { call } = setup({ consumers: [] });
    const echo = (await call('PUT', 'consumers/jo', { username: 'jo', plugins: { 'key-auth': { key: 'k' }, 'jwt-auth': { key: 'id', secret: 's' } } })).body.value as { plugins: Record<string, Obj> };
    expect(echo.plugins['key-auth']?.key).toMatch(/^\$ENC\$v1\$/);
    expect(echo.plugins['jwt-auth']).toEqual({ key: 'id', secret: expect.stringMatching(/^\$ENC\$v1\$/) as string });
  });

  it('the bare credentials path answers a GET only', async () => {
    const { call } = setup();
    expect((await call('GET', 'credentials')).status).toBe(200);
    expect((await call('PUT', 'credentials', {})).status).toBe(405);
  });
});
