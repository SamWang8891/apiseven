import type { Kind, Obj } from '../api/types';
import { atEncryptPath } from '../schema/secrets';
import { pluginFixture } from './pluginFixture';

/** The epoch seconds the fake's timestamps count from (one tick per write). */
const CLOCK = 1_800_000_000;

/** Object counts per kind in dev/seed.mjs. */
export const SEED_COUNTS: Partial<Record<Kind, number>> = {
  routes: 10,
  stream_routes: 1,
  services: 2,
  upstreams: 2,
  consumers: 2,
  consumer_groups: 1,
  ssls: 1,
  global_rules: 1,
  plugin_configs: 1,
  protos: 1,
};

/**
 * A custom answer (a promise holds it back); `undefined` hands the request on to the default
 * handling, also when a promise resolves to it (to hold a request, then answer it as usual).
 */
type Reply = (req: FakeRequest) => Response | Promise<Response | undefined> | 'network' | undefined;

export interface FakeAdminOptions {
  /** The body of ./config.json; it answers 404 when this is undefined. */
  config?: unknown;
  /** The only key the Admin API accepts (401 otherwise, like APISIX). Undefined: no key check. */
  key?: string;
  /** Number of objects per kind; kinds left out are empty. Default SEED_COUNTS. */
  counts?: Partial<Record<Kind, number>>;
  /** Replies by admin path (the part after /apisix/admin/, no query), taking precedence. */
  replies?: Record<string, Reply>;
  /**
   * Stored objects per kind, which writes then change like APISIX: POST adds one under a generated
   * id, PUT replaces one, PATCH merges into it (nested objects merge, `null` removes a key, arrays are
   * replaced), DELETE removes it. Each object carries a `modifiedIndex` that every write to it raises;
   * GETs report it, write responses don't (as in APISIX). SSL GETs leave out `key` / `keys`. A kind
   * listed here ignores `counts`. The id is `username` for consumers, else `id`.
   */
  objects?: Partial<Record<Kind, Obj[]>>;
  /**
   * Stored credentials by consumer username, answered at `consumers/<username>/credentials[/<id>]`
   * like `objects`. A consumer without an entry has no credentials directory: its list is a 404, as
   * in APISIX. The bare `credentials` path answers as APISIX 3.11+ does (a listing), so the kind is
   * supported; replace it with a 404 reply for an older APISIX.
   */
  credentials?: Record<string, Obj[]>;
}

export interface FakeRequest {
  url: URL;
  method: string;
  key: string | null;
  /** The parsed JSON body, when there is one. */
  body?: unknown;
}

const SERVER = { Server: 'APISIX/3.20.0', 'Content-Type': 'application/json' };

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: SERVER });
}

/** What a reverse proxy in front of APISIX answers when APISIX is down. */
export function html502(): Response {
  return new Response('<html><body><h1>502 Bad Gateway</h1></body></html>', {
    status: 502,
    headers: { 'Content-Type': 'text/html' },
  });
}

const KINDS = new Set<string>([
  'routes', 'services', 'upstreams', 'consumers', 'consumer_groups', 'ssls', 'global_rules',
  'plugin_configs', 'plugin_metadata', 'protos', 'secrets', 'stream_routes',
]);

/**
 * A fetch that answers like APISIX 3.20's Admin API (and the page's config.json), recording every
 * request. Lists hold `count` objects with ids `<kind>-1`, `<kind>-2`, …
 */
export function fakeAdmin(opts: FakeAdminOptions = {}) {
  const requests: FakeRequest[] = [];
  // etcd's revision: one counter for every write.
  const revision = { n: 100 };
  const counts = opts.counts ?? SEED_COUNTS;
  const objects = new Map<string, Stored[]>(
    Object.entries(opts.objects ?? {}).map(([kind, list]) => [kind, list.map((value) => ({ value: { ...value }, index: ++revision.n }))]),
  );
  const credentials = new Map<string, Stored[]>(
    Object.entries(opts.credentials ?? {}).map(([consumer, list]) => [consumer, list.map((value) => ({ value: { ...value }, index: ++revision.n }))]),
  );

  const fetchImpl: typeof fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, document.baseURI);
    const headers = new Headers(init?.headers);
    const req: FakeRequest = { url, method: init?.method ?? 'GET', key: headers.get('X-API-KEY') };
    if (typeof init?.body === 'string') req.body = JSON.parse(init.body);
    requests.push(req);

    if (url.pathname.endsWith('/config.json')) {
      return Promise.resolve(
        opts.config === undefined ? new Response('Not Found', { status: 404 }) : new Response(JSON.stringify(opts.config)),
      );
    }

    const path = url.pathname.replace(/^.*?\/apisix\/admin\//, '');
    const reply = opts.replies?.[path]?.(req);
    if (reply === 'network') return Promise.reject(new TypeError('Failed to fetch'));
    if (reply instanceof Promise) return reply.then((r) => r ?? byDefault(path, headers, req));
    if (reply) return Promise.resolve(reply);
    return Promise.resolve(byDefault(path, headers, req));
  };

  /** The answer without a custom reply: the key check, the stored objects, the counted lists. */
  function byDefault(path: string, headers: Headers, req: FakeRequest): Response {
    if (opts.key !== undefined && headers.get('X-API-KEY') !== opts.key) {
      const description = headers.has('X-API-KEY') ? 'wrong apikey' : 'missing apikey';
      return json(401, { description, error_msg: 'failed to check token' });
    }

    const [kind = '', ...rest] = path.split('/');
    if (kind === 'consumers' && rest[1] === 'credentials') return credentialsOf(rest, req);
    if (path === 'credentials') {
      if (req.method !== 'GET') return json(405, { error_msg: 'not supported `' + req.method + '` method for credential' });
      const all = [...credentials.entries()].flatMap(([consumer, list]) =>
        list.map((s) => ({ key: `/apisix/consumers/${consumer}/credentials/${String(s.value.id)}`, value: s.value })),
      );
      return json(200, { total: all.length, list: all.length === 0 ? {} : all });
    }
    const stored = objects.get(kind);
    if (stored) return answer(kind, stored, rest.length ? decodeURIComponent(rest.join('/')) : undefined, req, revision);

    if (KINDS.has(path)) {
      const n = counts[path as Kind] ?? 0;
      const list = Array.from({ length: n }, (_, i) => {
        const id = `${path}-${i + 1}`;
        const value: Obj = path === 'consumers' ? { username: id } : { id };
        return { key: `/apisix/${path}/${id}`, value };
      });
      // An empty Lua table encodes as a JSON object, so an empty list arrives as {}.
      return json(200, { total: n, list: n === 0 ? {} : list });
    }
    return json(404, { error_msg: 'Unsupported resource type' });
  }

  /** `consumers/<username>/credentials[/<id>]`: a consumer's credentials, created by the first PUT. */
  function credentialsOf(rest: string[], req: FakeRequest): Response {
    const consumer = decodeURIComponent(rest[0] ?? '');
    const id = rest[2] === undefined ? undefined : decodeURIComponent(rest.slice(2).join('/'));
    let list = credentials.get(consumer);
    if (!list && req.method === 'PUT') {
      const consumers = objects.get('consumers');
      if (consumers && !consumers.some((c) => c.value.username === consumer)) return json(404, { error_msg: 'consumer not found' });
      list = [];
      credentials.set(consumer, list);
    }
    if (!list) return json(404, { message: 'Key not found' });
    return answer('credentials', list, id, req, revision, `/apisix/consumers/${consumer}/credentials`);
  }

  /** The stored objects of a kind as APISIX holds them now (SSL keys included); credentials need their consumer. */
  const stored = (kind: Kind, consumer?: string): Obj[] =>
    ((kind === 'credentials' ? credentials.get(consumer ?? '') : objects.get(kind)) ?? []).map((entry) => entry.value);

  /** Changes a stored object behind the editor's back (another user's save): raises its modifiedIndex. Credentials need their consumer. */
  function touch(kind: Kind, id: string, change: Obj, consumer?: string): void {
    const entry = (kind === 'credentials' ? credentials.get(consumer ?? '') : objects.get(kind))?.find((e) => idOf(kind, e.value) === id);
    if (!entry) throw new Error(`no stored ${kind} ${id}`);
    entry.value = { ...entry.value, ...change };
    entry.index = ++revision.n;
  }

  return { fetch: fetchImpl, requests, stored, touch };
}

interface Stored {
  value: Obj;
  /** etcd's modifiedIndex: the revision of the last write to it. */
  index: number;
}

const idOf = (kind: string, value: Obj): string => String(kind === 'consumers' ? value.username : value.id);

/** APISIX's PATCH merge (core.table.merge): nested objects merge, null removes, arrays and empty tables replace. */
function merge(origin: Obj, extend: Obj): Obj {
  const out: Obj = { ...origin };
  for (const [k, v] of Object.entries(extend)) {
    const old = out[k];
    if (v === null) delete out[k];
    else if (isPlain(v) && isPlain(old) && Object.keys(v).length > 0 && Object.keys(old).length > 0) out[k] = merge(old, v);
    else out[k] = v;
  }
  return out;
}

const isPlain = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Secrets as APISIX 3.20 keeps them (checked on the dev APISIX):
 * - a plugin's `encrypt_fields`, in any kind's `plugins`, are stored encrypted and echoed by a
 *   write's response as `$ENC$v1$…`, while a GET returns the clear text. The fields come from the
 *   plugin fixture: the schema the kind checks the plugin with (a consumer's and a credential's: the
 *   consumer schema; a stream route's: the stream set), every path as `process_encrypt_field` walks
 *   it (apisix/plugin.lua 1116–1190: dotted, arrays walked at each step, a string, a list of
 *   strings or a map of strings at the end);
 * - a private key in PEM form (an SSL's `key` / `keys`, an upstream's or an inline upstream's
 *   `tls.client_key`) is stored AES-encrypted: only PEM is (`aes_encrypt_pkey`, apisix/ssl.lua
 *   89–95), anything else passes through. The write's response echoes the ciphertext; an upstream's
 *   GET returns it as stored; an SSL's GET leaves `key` / `keys` out.
 */
function encryptFieldsOf(kind: string, name: string): string[] {
  const fixture = pluginFixture();
  const info = kind === 'stream_routes' ? fixture.stream[name] : fixture.http[name];
  const schema = kind === 'consumers' || kind === 'credentials' ? (info?.consumer_schema ?? info?.schema) : info?.schema;
  const list: unknown = schema?.encrypt_fields;
  return Array.isArray(list) ? list.filter((f): f is string => typeof f === 'string') : [];
}

const enc = (v: string): string => `$ENC$v1$${btoa(encodeURIComponent(v))}`;

/** What process_encrypt_field encrypts at the end of a path: a string, each string of a list, each string of a map. */
function encryptLeaf(v: unknown): unknown {
  if (typeof v === 'string') return enc(v);
  if (Array.isArray(v)) return (v as unknown[]).map((x) => (typeof x === 'string' ? enc(x) : x));
  if (isPlain(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === 'string' ? enc(x) : x]));
  return v;
}

/** The stand-in for APISIX's AES ciphertext of a PEM key: no longer PEM, so a later write passes it through. */
const aes = (v: unknown): unknown => (typeof v === 'string' && v.startsWith('---') ? `AES:${btoa(encodeURIComponent(v))}` : v);

function withClientKey(upstream: unknown): unknown {
  if (!isPlain(upstream) || !isPlain(upstream.tls) || upstream.tls.client_key === undefined) return upstream;
  return { ...upstream, tls: { ...upstream.tls, client_key: aes(upstream.tls.client_key) } };
}

/** A written value as APISIX stores it: PEM private keys encrypted. */
function storedAs(kind: string, value: Obj): Obj {
  if (kind === 'ssls') {
    const out = { ...value };
    if (out.key !== undefined) out.key = aes(out.key);
    if (Array.isArray(out.keys)) out.keys = out.keys.map(aes);
    return out;
  }
  if (kind === 'upstreams') return withClientKey(value) as Obj;
  if (isPlain(value.upstream)) return { ...value, upstream: withClientKey(value.upstream) };
  return value;
}

/** What a write's response shows: the stored value, its plugins' encrypted fields as `$ENC$v1$…`. */
function echoed(kind: string, value: Obj): Obj {
  if (!isPlain(value.plugins)) return value;
  const plugins = Object.fromEntries(
    Object.entries(value.plugins).map(([name, conf]) => [name, encryptFieldsOf(kind, name).reduce<unknown>((out, field) => atEncryptPath(out, field.split('.'), encryptLeaf), conf)]),
  );
  return { ...value, plugins };
}

/**
 * What a POST or PUT may not carry (admin/resource.lua 113–119, check_forbidden_properties 55–83): a
 * timestamp at the top, in `upstream`, or as a key of `plugins`. A PATCH may (allow_time).
 */
function forbidden(body: Obj): string | undefined {
  for (const field of ['create_time', 'update_time']) {
    if (body[field] !== undefined) return field;
    if (isPlain(body.upstream) && body.upstream[field] !== undefined) return `upstream.${field}`;
    if (isPlain(body.plugins) && body.plugins[field] !== undefined) return `plugins.${field}`;
  }
  return undefined;
}

/** What a GET shows: SSL private keys never leave APISIX. */
function shown(kind: string, value: Obj): Obj {
  if (kind !== 'ssls') return value;
  const copy = { ...value };
  delete copy.key;
  delete copy.keys;
  return copy;
}

/**
 * The Admin API over a kind's stored objects: list, get, POST, PUT, PATCH, DELETE. `prefix` is the
 * collection's etcd key (a consumer's credentials live under the consumer).
 */
function answer(kind: string, stored: Stored[], id: string | undefined, req: FakeRequest, revision: { n: number }, prefix = `/apisix/${kind}`): Response {
  const entry = (value: Obj) => ({ key: `${prefix}/${idOf(kind, value)}`, value });
  // A write's response, as APISIX sends it: secrets as ciphertext (echoed), and no modifiedIndex.
  const written = (value: Obj) => entry(echoed(kind, value));
  const read = (s: Stored) => ({ ...entry(shown(kind, s.value)), modifiedIndex: s.index, createdIndex: s.index });
  const body = (req.body ?? {}) as Obj;
  // APISIX stamps every write (admin/utils.lua inject_conf_with_prev_conf): create_time kept, update_time now.
  const now = () => CLOCK + revision.n;
  if ((req.method === 'POST' || req.method === 'PUT') && forbidden(body)) {
    return json(400, { error_msg: `the property is forbidden:  ${forbidden(body) ?? ''}` });
  }
  if (id === undefined) {
    if (req.method === 'POST') {
      const value = storedAs(kind, { ...body, id: String(revision.n + 1).padStart(20, '0'), create_time: now(), update_time: now() });
      stored.push({ value, index: ++revision.n });
      return json(201, written(value));
    }
    if (req.method !== 'GET') return json(405, { error_msg: 'not supported here' });
    return json(200, { total: stored.length, list: stored.length === 0 ? {} : stored.map(read) });
  }
  const at = stored.findIndex((s) => idOf(kind, s.value) === id);
  const current = stored[at];
  switch (req.method) {
    case 'GET':
      return current ? json(200, read(current)) : json(404, { message: 'Key not found' });
    case 'PUT': {
      const created = typeof current?.value.create_time === 'number' ? current.value.create_time : now();
      const value = storedAs(kind, { ...body, ...(kind === 'consumers' ? {} : { id }), create_time: created, update_time: now() });
      if (current) {
        current.value = value;
        current.index = ++revision.n;
      } else stored.push({ value, index: ++revision.n });
      return json(current ? 200 : 201, written(value));
    }
    case 'PATCH': {
      if (!current) return json(404, { message: 'Key not found' });
      current.value = storedAs(kind, { ...merge(current.value, body), ...(body.update_time === undefined ? { update_time: now() } : {}) });
      current.index = ++revision.n;
      return json(200, written(current.value));
    }
    case 'DELETE':
      if (at < 0) return json(404, { message: 'Key not found' });
      stored.splice(at, 1);
      return json(200, { deleted: '1', key: `${prefix}/${id}` });
    default:
      return json(405, { error_msg: 'not supported here' });
  }
}
