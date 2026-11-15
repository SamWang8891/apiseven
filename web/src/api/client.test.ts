import { describe, expect, it } from 'vitest';
import { AdminClient } from './client';
import { ApiError } from './errors';
import type { Connection } from './types';

interface Call {
  url: string;
  method: string;
  headers: Headers;
  body?: string;
  credentials?: RequestCredentials;
}

type Responder = (call: Call) => Response | Promise<Response>;

const CONN: Connection = { id: 'c1', name: 'dev', baseUrl: 'http://apisix:9180', key: 'secret' };
const ADMIN = 'http://apisix:9180/apisix/admin';

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function entry(kind: string, id: string, value: Record<string, unknown> = { id }) {
  return { key: `/apisix/${kind}/${id}`, value, createdIndex: 7, modifiedIndex: 9 };
}

/** An AdminClient over a fake fetch that records every request. */
function setup(respond: Responder, conn: Connection = CONN) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const call: Call = {
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : undefined,
      credentials: init?.credentials,
    };
    calls.push(call);
    return Promise.resolve(respond(call));
  };
  return { api: new AdminClient(conn, fetchImpl), calls };
}

async function apiError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ApiError) return err;
    throw err;
  }
  throw new Error('expected the promise to reject');
}

describe('list', () => {
  it('requests page=1&page_size=500 and stops when the first page holds everything', async () => {
    const { api, calls } = setup(() => json({ total: 2, list: [entry('routes', 'a'), entry('routes', 'b')] }));
    const items = await api.list('routes');
    expect(calls.map((c) => c.url)).toEqual([`${ADMIN}/routes?page=1&page_size=500`]);
    expect(items).toEqual([
      { id: 'a', value: { id: 'a' }, createdIndex: 7, modifiedIndex: 9 },
      { id: 'b', value: { id: 'b' }, createdIndex: 7, modifiedIndex: 9 },
    ]);
  });

  it('requests pages 2 and 3 when total is 1200 and returns all 1200 items', async () => {
    const { api, calls } = setup((call) => {
      const page = Number(new URL(call.url).searchParams.get('page'));
      const count = page < 3 ? 500 : 200;
      const list = Array.from({ length: count }, (_, i) => entry('routes', `r${(page - 1) * 500 + i}`));
      return json({ total: 1200, list });
    });
    const items = await api.list('routes');
    expect(calls.map((c) => c.url).sort()).toEqual([
      `${ADMIN}/routes?page=1&page_size=500`,
      `${ADMIN}/routes?page=2&page_size=500`,
      `${ADMIN}/routes?page=3&page_size=500`,
    ]);
    expect(items).toHaveLength(1200);
    expect(new Set(items.map((i) => i.id)).size).toBe(1200);
  });

  it('returns [] for an empty list that APISIX encodes as an object', async () => {
    const { api } = setup(() => json({ total: 0, list: {} }));
    expect(await api.list('secrets')).toEqual([]);
  });

  it('lists credentials under the parent consumer, encoded', async () => {
    const { api, calls } = setup(() => json({ total: 0, list: [] }));
    await api.list('credentials', { consumer: 'jo e' });
    expect(calls[0]?.url).toBe(`${ADMIN}/consumers/jo%20e/credentials?page=1&page_size=500`);
  });

  it('returns [] for credentials when APISIX answers 404 (a consumer with none)', async () => {
    const { api } = setup(() => json({ message: 'Key not found' }, 404));
    expect(await api.list('credentials', { consumer: 'bob' })).toEqual([]);
  });

  it('fails with kind parse when the body has no list', async () => {
    const { api } = setup(() => json({ hello: 'world' }));
    expect((await apiError(api.list('routes'))).kind).toBe('parse');
  });
});

describe('item ids', () => {
  it('uses username for consumers', async () => {
    const { api } = setup(() =>
      json({ total: 1, list: [{ key: '/apisix/consumers/alice', value: { username: 'alice' } }] }),
    );
    expect((await api.list('consumers'))[0]?.id).toBe('alice');
  });

  it('uses the plugin name (last key segment) for plugin_metadata', async () => {
    const { api } = setup(() =>
      json({ key: '/apisix/plugin_metadata/http-logger', value: { log_format: {} } }),
    );
    expect((await api.get('plugin_metadata', 'http-logger')).id).toBe('http-logger');
  });

  it('uses <manager>/<id> for secrets', async () => {
    const { api } = setup(() =>
      json({ total: 1, list: [{ key: '/apisix/secrets/vault/my id', value: { uri: 'http://v' } }] }),
    );
    expect((await api.list('secrets'))[0]?.id).toBe('vault/my id');
  });

  it('coerces a numeric id to a string', async () => {
    const { api } = setup(() => json({ key: '/apisix/routes/12', value: { id: 12, uri: '/' } }));
    const item = await api.get('routes', '12');
    expect(item.id).toBe('12');
    expect(item.value).toEqual({ id: 12, uri: '/' });
  });
});

describe('requests', () => {
  async function exercise(api: AdminClient) {
    await api.list('routes');
    await api.get('routes', 'r1');
    await api.create('routes', { uri: '/' });
    await api.replace('routes', 'r1', { uri: '/' });
    await api.patch('routes', 'r1', { status: 0 });
    await api.remove('routes', 'r1');
  }

  function respondForAll(call: Call): Response {
    if (call.method === 'DELETE') return json({ deleted: '1', key: '/apisix/routes/r1' });
    if (call.url.includes('page=')) return json({ total: 0, list: [] });
    return json({ key: '/apisix/routes/r1', value: { id: 'r1' } });
  }

  it('sends X-API-KEY on every request when the connection has a key', async () => {
    const { api, calls } = setup(respondForAll);
    await exercise(api);
    expect(calls).toHaveLength(6);
    for (const call of calls) expect(call.headers.get('X-API-KEY')).toBe('secret');
  });

  it('omits X-API-KEY when the connection has no key', async () => {
    const { api, calls } = setup(respondForAll, { ...CONN, key: undefined });
    await exercise(api);
    expect(calls).toHaveLength(6);
    for (const call of calls) expect(call.headers.has('X-API-KEY')).toBe(false);
  });

  it('never sends cookies and sets Content-Type only when there is a body', async () => {
    const { api, calls } = setup(respondForAll);
    await exercise(api);
    for (const call of calls) {
      expect(call.credentials).toBe('omit');
      expect(call.headers.get('Content-Type')).toBe(call.body === undefined ? null : 'application/json');
    }
    expect(calls.filter((c) => c.body !== undefined).map((c) => c.method)).toEqual(['POST', 'PUT', 'PATCH']);
  });

  it('encodes ids and parents in the path', async () => {
    const { api, calls } = setup((call) =>
      call.url.includes('page=') ? json({ total: 0, list: [] }) : json({ key: '/apisix/x/y', value: { id: 'y' } }),
    );
    // An id with a slash is never sent (R4, below); everything else is encoded.
    await api.get('consumers', 'a b%c?');
    await api.get('secrets', 'vault/my id');
    await api.list('credentials', { consumer: 'jo e' });
    expect(calls.map((c) => c.url)).toEqual([
      `${ADMIN}/consumers/a%20b%25c%3F`,
      `${ADMIN}/secrets/vault/my%20id`,
      `${ADMIN}/consumers/jo%20e/credentials?page=1&page_size=500`,
    ]);
  });

  it('trims trailing slashes from baseUrl and accepts an empty or relative one', async () => {
    const urls: string[] = [];
    for (const baseUrl of ['http://apisix:9180//', '', '/proxy/']) {
      const { api, calls } = setup(() => json({ total: 0, list: [] }), { ...CONN, baseUrl });
      await api.list('routes');
      urls.push(calls[0]?.url ?? '');
    }
    expect(urls).toEqual([
      'http://apisix:9180/apisix/admin/routes?page=1&page_size=500',
      '/apisix/admin/routes?page=1&page_size=500',
      '/proxy/apisix/admin/routes?page=1&page_size=500',
    ]);
  });
});

describe('errors', () => {
  it('maps 401 to kind auth, keeping APISIX error_msg and description', async () => {
    const { api } = setup(() =>
      json({ error_msg: 'failed to check token', description: 'wrong apikey' }, 401),
    );
    const err = await apiError(api.list('routes'));
    expect(err.kind).toBe('auth');
    expect(err.status).toBe(401);
    expect(err.errorMsg).toBe('failed to check token: wrong apikey');
  });

  it('maps a rejected fetch to kind network', async () => {
    const { api } = setup(() => Promise.reject(new TypeError('Failed to fetch')));
    const err = await apiError(api.list('routes'));
    expect(err.kind).toBe('network');
    expect(err.status).toBeUndefined();
  });

  it('maps 400 with error_msg to kind http with errorMsg', async () => {
    const { api } = setup(() => json({ error_msg: 'x' }, 400));
    const err = await apiError(api.create('routes', {}));
    expect(err.kind).toBe('http');
    expect(err.status).toBe(400);
    expect(err.errorMsg).toBe('x');
    expect(err.message).toBe('HTTP 400: x');
  });

  it('maps 502 with an HTML body to kind parse with status 502', async () => {
    const { api } = setup(
      () => new Response('<html><body>Bad Gateway</body></html>', { status: 502, headers: { 'Content-Type': 'text/html' } }),
    );
    const err = await apiError(api.list('routes'));
    expect(err.kind).toBe('parse');
    expect(err.status).toBe(502);
  });

  it('uses etcd\'s message when there is no error_msg', async () => {
    const { api } = setup(() => json({ message: 'Key not found' }, 404));
    const err = await apiError(api.get('routes', 'nope'));
    expect(err.kind).toBe('http');
    expect(err.errorMsg).toBe('Key not found');
  });

  it('maps a 200 with a non-JSON body to kind parse', async () => {
    const { api } = setup(() => new Response('<!doctype html><title>app</title>', { status: 200 }));
    expect((await apiError(api.list('routes'))).kind).toBe('parse');
  });
});

describe('create, replace, patch, remove', () => {
  function echo(call: Call): Response {
    return json({ key: '/apisix/x/new', value: { id: 'new', ...(JSON.parse(call.body ?? '{}') as object) } });
  }

  it('uses PUT to /consumers for a consumer (no POST)', async () => {
    const { api, calls } = setup(() => json({ key: '/apisix/consumers/u', value: { username: 'u' } }));
    const item = await api.create('consumers', { username: 'u' });
    expect(calls.map((c) => [c.method, c.url])).toEqual([['PUT', `${ADMIN}/consumers`]]);
    expect(calls[0]?.body).toBe('{"username":"u"}');
    expect(item.id).toBe('u');
  });

  it('uses POST for a route without an id', async () => {
    const { api, calls } = setup(echo);
    const item = await api.create('routes', { uri: '/a' });
    expect(calls.map((c) => [c.method, c.url])).toEqual([['POST', `${ADMIN}/routes`]]);
    expect(item).toEqual({ id: 'new', value: { id: 'new', uri: '/a' } });
  });

  it('uses PUT /routes/r1 for a route with an id', async () => {
    const { api, calls } = setup(echo);
    await api.create('routes', { uri: '/a' }, 'r1');
    expect(calls.map((c) => [c.method, c.url])).toEqual([['PUT', `${ADMIN}/routes/r1`]]);
  });

  it('uses PUT to the collection for kinds without POST', async () => {
    const { api, calls } = setup(echo);
    await api.create('global_rules', { id: 'g', plugins: {} });
    await api.create('credentials', { id: 'k', plugins: {} }, undefined, { consumer: 'jo' });
    await api.create('credentials', { plugins: {} }, 'k', { consumer: 'jo' });
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ['PUT', `${ADMIN}/global_rules`],
      ['PUT', `${ADMIN}/consumers/jo/credentials`],
      ['PUT', `${ADMIN}/consumers/jo/credentials/k`],
    ]);
  });

  it('replace uses PUT and patch uses PATCH on the item', async () => {
    const { api, calls } = setup(echo);
    await api.replace('ssls', 's1', { snis: ['a.test'] });
    await api.patch('ssls', 's1', { status: 0 });
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ['PUT', `${ADMIN}/ssls/s1`, '{"snis":["a.test"]}'],
      ['PATCH', `${ADMIN}/ssls/s1`, '{"status":0}'],
    ]);
  });

  it('refuses PATCH for kinds APISIX does not allow it on, without a request', async () => {
    const { api, calls } = setup(echo);
    for (const kind of ['consumers', 'protos', 'stream_routes', 'plugin_metadata'] as const) {
      await expect(api.patch(kind, 'x', {})).rejects.toThrow(/PATCH/);
    }
    expect(calls).toHaveLength(0);
  });

  it('remove sends DELETE and resolves to undefined', async () => {
    const { api, calls } = setup(() => json({ deleted: '1', key: '/apisix/routes/r1' }));
    expect(await api.remove('routes', 'r1')).toBeUndefined();
    expect(calls.map((c) => [c.method, c.url])).toEqual([['DELETE', `${ADMIN}/routes/r1`]]);
  });
});

describe('ping', () => {
  it('requests one small page of routes and reads the version from the Server header', async () => {
    const { api, calls } = setup(() => json({ total: 0, list: {} }, 200, { Server: 'APISIX/3.20.0' }));
    expect(await api.ping()).toEqual({ version: '3.20.0' });
    expect(calls.map((c) => c.url)).toEqual([`${ADMIN}/routes?page=1&page_size=10`]);
  });

  it('returns {} when the Server header is not readable', async () => {
    const { api } = setup(() => json({ total: 0, list: [] }));
    expect(await api.ping()).toEqual({});
  });

  it('fails with kind parse when the URL does not answer like the Admin API', async () => {
    const { api } = setup(() => json({ status: 'ok' }));
    expect((await apiError(api.ping())).kind).toBe('parse');
  });
});

describe('plugins', () => {
  it('pluginNames lists http plugins, or stream ones on request', async () => {
    const { api, calls } = setup((call) =>
      json(call.url.includes('stream') ? ['limit-conn'] : ['cors', 'key-auth']),
    );
    expect(await api.pluginNames()).toEqual(['cors', 'key-auth']);
    expect(await api.pluginNames('stream')).toEqual(['limit-conn']);
    expect(calls.map((c) => c.url)).toEqual([`${ADMIN}/plugins/list`, `${ADMIN}/plugins/list?subsystem=stream`]);
  });

  it('pluginSchema asks for the stream or consumer schema when told to', async () => {
    const { api, calls } = setup(() => json({ type: 'object' }));
    expect(await api.pluginSchema('key-auth')).toEqual({ type: 'object' });
    await api.pluginSchema('key-auth', { consumer: true });
    await api.pluginSchema('limit-conn', { subsystem: 'stream' });
    expect(calls.map((c) => c.url)).toEqual([
      `${ADMIN}/plugins/key-auth`,
      `${ADMIN}/plugins/key-auth?schema_type=consumer`,
      `${ADMIN}/plugins/limit-conn?subsystem=stream`,
    ]);
  });

  it('allPlugins fetches plugins?all=true once per client', async () => {
    const all = { 'limit-count': { schema: { type: 'object' }, priority: 1002 } };
    const { api, calls } = setup(() => json(all));
    expect(await api.allPlugins()).toEqual(all);
    expect(await api.allPlugins()).toEqual(all);
    expect(calls.map((c) => c.url)).toEqual([`${ADMIN}/plugins?all=true`]);
  });

  it('allPlugins("stream") fetches the stream set, cached apart from the http one', async () => {
    const httpSet = { 'limit-count': { schema: { type: 'object' } } };
    const streamSet = { 'limit-conn': { schema: { type: 'object' } } };
    const { api, calls } = setup((call) => json(call.url.includes('subsystem=stream') ? streamSet : httpSet));
    expect(await api.allPlugins('stream')).toEqual(streamSet);
    expect(await api.allPlugins()).toEqual(httpSet);
    expect(await api.allPlugins('stream')).toEqual(streamSet);
    expect(calls.map((c) => c.url)).toEqual([`${ADMIN}/plugins?all=true&subsystem=stream`, `${ADMIN}/plugins?all=true`]);
  });

  it('allPlugins tries again after a failure', async () => {
    let fail = true;
    const { api, calls } = setup(() => (fail ? json({ error_msg: 'down' }, 503) : json({})));
    await expect(api.allPlugins()).rejects.toBeInstanceOf(ApiError);
    fail = false;
    expect(await api.allPlugins()).toEqual({});
    expect(calls).toHaveLength(2);
  });
});

describe('resourceSchema', () => {
  it('fetches schema/<name> once per client and name', async () => {
    const { api, calls } = setup((call) => json({ type: 'object', title: call.url.split('/').pop() }));
    expect(await api.resourceSchema('upstream')).toEqual({ type: 'object', title: 'upstream' });
    expect(await api.resourceSchema('upstream')).toEqual({ type: 'object', title: 'upstream' });
    await api.resourceSchema('route');
    expect(calls.map((c) => c.url)).toEqual([`${ADMIN}/schema/upstream`, `${ADMIN}/schema/route`]);
  });

  it('tries again after a failure, and refuses an answer that is not an object', async () => {
    let answer: Response = json({ error_msg: 'down' }, 503);
    const { api, calls } = setup(() => answer);
    await expect(api.resourceSchema('upstream')).rejects.toBeInstanceOf(ApiError);
    answer = json(['not', 'a', 'schema']);
    expect((await apiError(api.resourceSchema('upstream'))).kind).toBe('parse');
    answer = json({ type: 'object' });
    expect(await api.resourceSchema('upstream')).toEqual({ type: 'object' });
    expect(calls).toHaveLength(3);
  });
});

describe('supports', () => {
  it('is false for credentials on a 404', async () => {
    const { api } = setup(() => json({ error_msg: 'Unsupported resource type: credentials' }, 404));
    expect(await api.supports('credentials')).toBe(false);
  });

  it('is true when the list endpoint answers', async () => {
    const { api, calls } = setup(() => json({ total: 0, list: {} }));
    expect(await api.supports('credentials')).toBe(true);
    expect(await api.supports('routes')).toBe(true);
    expect(calls.map((c) => c.url)).toEqual([
      `${ADMIN}/credentials?page=1&page_size=10`,
      `${ADMIN}/routes?page=1&page_size=10`,
    ]);
  });

  it('is false when APISIX refuses the list (stream mode disabled)', async () => {
    const { api } = setup(() => json({ error_msg: 'stream mode is disabled, can not add stream routes' }, 400));
    expect(await api.supports('stream_routes')).toBe(false);
  });

  it('rethrows auth and network failures', async () => {
    const { api } = setup(() => json({ error_msg: 'failed to check token' }, 401));
    expect((await apiError(api.supports('routes'))).kind).toBe('auth');
  });

  // Task 16b item 66: only APISIX's own answer for a missing resource or a disabled subsystem
  // (admin/init.lua 191-199, 215-218) says "not supported"; any other refusal is not known, and asked again.
  it.each([
    ['a 404 of another kind', () => json({ error_msg: 'not found' }, 404)],
    ['a 408', () => json({ error_msg: 'timeout' }, 408)],
    ['a 429', () => json({ error_msg: 'too many requests' }, 429)],
    ['a proxy page', () => new Response('<html>404 Not Found</html>', { status: 404, headers: { 'Content-Type': 'text/html' } })],
    ['another 400', () => json({ error_msg: 'invalid request' }, 400)],
  ])('%s is not an answer: it rethrows', async (_, respond) => {
    const { api } = setup(respond);
    await expect(api.supports('stream_routes')).rejects.toBeInstanceOf(ApiError);
  });

  it("is false only for APISIX's own answers: Unsupported resource type (any kind), stream mode disabled (stream routes)", async () => {
    expect(await setup(() => json({ error_msg: 'Unsupported resource type: protos' }, 404)).api.supports('protos')).toBe(false);
    expect(await setup(() => json({ error_msg: 'stream mode is disabled, can not add stream routes' }, 400)).api.supports('stream_routes')).toBe(false);
    await expect(setup(() => json({ error_msg: 'stream mode is disabled, can not add stream routes' }, 400)).api.supports('routes')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('an id that is not one path segment is never sent (fix round 2, R4)', () => {
  const ok = () => json({ key: '/apisix/routes/r1', value: { id: 'r1' } });

  it.each([
    ['routes', 'r1/x'],
    ['routes', '..'],
    ['routes', '.'],
    ['upstreams', ''],
    ['consumers', 'a/credentials/k0'],
    ['plugin_metadata', '..'],
    ['ssls', 'a%2Fb/c'],
    ['secrets', 'vault/..'],
    ['secrets', 'vault'],
    ['secrets', 'vault/a/b'],
    ['secrets', '../a'],
  ] as const)('%s %s: reads and writes fail before any request, as not found, naming the id', async (kind, id) => {
    const { api, calls } = setup(ok);
    // create(kind, body, '') is a create without an id (POST or PUT to the collection), so '' is not tried there.
    const calls_ = [() => api.get(kind, id), () => api.replace(kind, id, {}), () => api.remove(kind, id), ...(id === '' ? [] : [() => api.create(kind, {}, id)])];
    for (const call of calls_) {
      const error = await apiError(call());
      expect(error.kind).toBe('refused');
      expect(error.status).toBe(404);
      expect(error.errorMsg).toContain(id);
    }
    if (kind !== 'consumers' && kind !== 'plugin_metadata') await apiError(api.patch(kind, id, {}));
    expect(calls).toEqual([]);
  });

  it.each([
    ['a/credentials/k0', 'k1'],
    ['..', 'k1'],
    ['', 'k1'],
    ['alice', '..'],
    ['alice', 'a/b'],
  ])('credentials of consumer "%s", id "%s": refused before any request (the consumer is judged too)', async (consumer, id) => {
    const { api, calls } = setup(ok);
    const parent = { consumer };
    await apiError(api.get('credentials', id, parent));
    await apiError(api.replace('credentials', id, {}, parent));
    await apiError(api.remove('credentials', id, parent));
    if (consumer !== 'alice') await apiError(api.list('credentials', parent));
    expect(calls).toEqual([]);
  });

  it('what is one segment goes as before: a secret is two, encoded each', async () => {
    const { api, calls } = setup((call) => json({ key: `/apisix/${call.url.split('/apisix/admin/')[1] ?? ''}`, value: {} }));
    await api.get('secrets', 'vault/my id');
    await api.get('credentials', 'k.1', { consumer: 'alice' });
    await api.get('routes', 'a..b');
    expect(calls.map((c) => c.url.replace(ADMIN, ''))).toEqual(['/secrets/vault/my%20id', '/consumers/alice/credentials/k.1', '/routes/a..b']);
  });
});
