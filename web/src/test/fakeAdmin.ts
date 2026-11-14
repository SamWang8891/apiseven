import type { Kind, Obj } from '../api/types';

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

/** A custom answer (a promise holds it back); `undefined` hands the request on to the default handling. */
type Reply = (req: FakeRequest) => Response | Promise<Response> | 'network' | undefined;

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
   * Stored objects per kind, which writes then change: PUT replaces one, PATCH merges its top-level
   * keys (APISIX merges deeper; enough for status toggles), DELETE removes it. A kind listed here
   * ignores `counts`. The id is `username` for consumers, else `id`.
   */
  objects?: Partial<Record<Kind, Obj[]>>;
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
  const counts = opts.counts ?? SEED_COUNTS;
  const objects = new Map<string, Obj[]>(
    Object.entries(opts.objects ?? {}).map(([kind, list]) => [kind, list.map((value) => ({ ...value }))]),
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
    if (reply) return reply instanceof Promise ? reply : Promise.resolve(reply);

    if (opts.key !== undefined && headers.get('X-API-KEY') !== opts.key) {
      const description = headers.has('X-API-KEY') ? 'wrong apikey' : 'missing apikey';
      return Promise.resolve(json(401, { description, error_msg: 'failed to check token' }));
    }

    const [kind = '', ...rest] = path.split('/');
    const stored = objects.get(kind);
    if (stored) return Promise.resolve(answer(kind, stored, rest.length ? decodeURIComponent(rest.join('/')) : undefined, req));

    if (KINDS.has(path)) {
      const n = counts[path as Kind] ?? 0;
      const list = Array.from({ length: n }, (_, i) => {
        const id = `${path}-${i + 1}`;
        const value: Obj = path === 'consumers' ? { username: id } : { id };
        return { key: `/apisix/${path}/${id}`, value };
      });
      // An empty Lua table encodes as a JSON object, so an empty list arrives as {}.
      return Promise.resolve(json(200, { total: n, list: n === 0 ? {} : list }));
    }
    return Promise.resolve(json(404, { error_msg: 'Unsupported resource type' }));
  };

  return { fetch: fetchImpl, requests };
}

const idOf = (kind: string, value: Obj): string => String(kind === 'consumers' ? value.username : value.id);

/** The Admin API over a kind's stored objects: list, get, PUT, PATCH, DELETE. */
function answer(kind: string, stored: Obj[], id: string | undefined, req: FakeRequest): Response {
  const entry = (value: Obj) => ({ key: `/apisix/${kind}/${idOf(kind, value)}`, value });
  if (id === undefined) {
    if (req.method !== 'GET') return json(405, { error_msg: 'not supported here' });
    return json(200, { total: stored.length, list: stored.length === 0 ? {} : stored.map(entry) });
  }
  const at = stored.findIndex((value) => idOf(kind, value) === id);
  const body = (req.body ?? {}) as Obj;
  switch (req.method) {
    case 'GET':
      return at < 0 ? json(404, { message: 'Key not found' }) : json(200, entry(stored[at] as Obj));
    case 'PUT': {
      const value = { ...body, ...(kind === 'consumers' ? {} : { id }) };
      if (at < 0) stored.push(value);
      else stored[at] = value;
      return json(at < 0 ? 201 : 200, entry(value));
    }
    case 'PATCH': {
      if (at < 0) return json(404, { message: 'Key not found' });
      const value = { ...(stored[at] as Obj), ...body };
      stored[at] = value;
      return json(200, entry(value));
    }
    case 'DELETE':
      if (at < 0) return json(404, { message: 'Key not found' });
      stored.splice(at, 1);
      return json(200, { deleted: '1', key: `/apisix/${kind}/${id}` });
    default:
      return json(405, { error_msg: 'not supported here' });
  }
}
