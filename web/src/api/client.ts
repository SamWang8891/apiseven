import { ApiError } from './errors';
import { isObj } from './sanitize';
import type { Connection, Item, Kind, Obj, Parent, PluginInfo } from './types';

/**
 * Methods each kind accepts besides GET / PUT / DELETE, from `unsupported_methods` in
 * apisix/admin/*.lua (APISIX 3.20). Without POST, a create without an ID is a PUT to the
 * collection with the ID (or `username`) in the body.
 */
const METHODS: Record<Kind, { post: boolean; patch: boolean }> = {
  routes: { post: true, patch: true },
  services: { post: true, patch: true },
  upstreams: { post: true, patch: true },
  consumers: { post: false, patch: false },
  credentials: { post: false, patch: false },
  consumer_groups: { post: false, patch: true },
  ssls: { post: true, patch: true },
  global_rules: { post: false, patch: true },
  plugin_configs: { post: false, patch: true },
  plugin_metadata: { post: false, patch: false },
  protos: { post: true, patch: false },
  secrets: { post: false, patch: true },
  stream_routes: { post: true, patch: false },
};

/** APISIX accepts page_size 10..500. */
const PAGE_SIZE = 500;
const SMALL_PAGE = { page: '1', page_size: '10' };

type Query = Record<string, string>;

interface Page {
  total: number;
  items: Item[];
}

const NOT_JSON = Symbol('not JSON');

export class AdminClient {
  readonly conn: Connection;
  private readonly fetchImpl: typeof fetch;
  private readonly adminUrl: string;
  /** Every plugin with its schemas, per subsystem ('http' | 'stream'), fetched once per client. */
  private readonly plugins = new Map<string, Promise<Record<string, PluginInfo>>>();
  /** Resource schemas by name ('upstream', 'route', …), fetched once per client. */
  private readonly schemas = new Map<string, Promise<Obj>>();

  constructor(conn: Connection, fetchImpl?: typeof fetch) {
    this.conn = conn;
    // Look the global up per call: an unbound reference to window.fetch throws "Illegal invocation".
    this.fetchImpl = fetchImpl ?? ((input, init) => fetch(input, init));
    this.adminUrl = `${conn.baseUrl.replace(/\/+$/, '')}/apisix/admin`;
  }

  /** Every object of a kind, fetched page by page (page_size 500). */
  async list(kind: Kind, parent?: Parent): Promise<Item[]> {
    const path = collectionPath(kind, parent);
    let first: Page;
    try {
      first = await this.page(kind, path, 1);
    } catch (err) {
      // A consumer without credentials has no credentials directory in etcd, so APISIX answers 404.
      if (kind === 'credentials' && err instanceof ApiError && err.status === 404) return [];
      throw err;
    }
    const pageCount = Math.ceil(first.total / PAGE_SIZE);
    const more = Array.from({ length: Math.max(0, pageCount - 1) }, (_, i) => this.page(kind, path, i + 2));
    const rest = await Promise.all(more);
    return [first, ...rest].flatMap((p) => p.items);
  }

  async get(kind: Kind, id: string, parent?: Parent): Promise<Item> {
    const { body } = await this.request('GET', itemPath(kind, id, parent));
    return toItem(kind, body);
  }

  /** POST when there is no ID and the kind allows POST; otherwise PUT (to the item when an ID is given). */
  async create(kind: Kind, body: Obj, id?: string, parent?: Parent): Promise<Item> {
    if (id) return this.replace(kind, id, body, parent);
    const method = METHODS[kind].post ? 'POST' : 'PUT';
    const res = await this.request(method, collectionPath(kind, parent), undefined, body);
    return toItem(kind, res.body);
  }

  async replace(kind: Kind, id: string, body: Obj, parent?: Parent): Promise<Item> {
    const res = await this.request('PUT', itemPath(kind, id, parent), undefined, body);
    return toItem(kind, res.body);
  }

  /** Merges `body` into the stored object. Rejects without a request for kinds that have no PATCH. */
  async patch(kind: Kind, id: string, body: Obj): Promise<Item> {
    if (!METHODS[kind].patch) throw new Error(`APISIX has no PATCH for ${kind}`);
    const res = await this.request('PATCH', itemPath(kind, id), undefined, body);
    return toItem(kind, res.body);
  }

  async remove(kind: Kind, id: string, parent?: Parent): Promise<void> {
    await this.request('DELETE', itemPath(kind, id, parent));
  }

  /** Checks the URL and key with one small page of routes; the version comes from the Server header. */
  async ping(): Promise<{ version?: string }> {
    // page_size alone does not paginate; APISIX needs page too.
    const { body, headers } = await this.request('GET', 'routes', SMALL_PAGE);
    parseList('routes', body);
    const version = /^APISIX\/(\S+)/i.exec(headers.get('Server') ?? '')?.[1];
    return version ? { version } : {};
  }

  /** Enabled plugin names, highest priority first. */
  async pluginNames(subsystem?: 'http' | 'stream'): Promise<string[]> {
    const { body } = await this.request('GET', 'plugins/list', subsystem ? { subsystem } : undefined);
    if (!isStringArray(body)) throw notAdminApi();
    return body;
  }

  /** A plugin's config schema; `consumer: true` gives the consumer-side schema (e.g. key-auth's `key`). */
  async pluginSchema(name: string, opts?: { subsystem?: 'stream'; consumer?: boolean }): Promise<Obj> {
    const query: Query = {};
    if (opts?.subsystem) query.subsystem = opts.subsystem;
    if (opts?.consumer) query.schema_type = 'consumer';
    const { body } = await this.request('GET', `plugins/${encodeURIComponent(name)}`, query);
    if (!isObj(body)) throw notAdminApi();
    return body;
  }

  /**
   * Every http plugin with its schemas (the only source of metadata_schema); with 'stream', every
   * stream plugin instead. Fetched once per client and subsystem; a failure is not kept.
   */
  allPlugins(subsystem?: 'stream'): Promise<Record<string, PluginInfo>> {
    const key = subsystem ?? 'http';
    let all = this.plugins.get(key);
    if (!all) {
      all = this.fetchAllPlugins(subsystem).catch((err: unknown) => {
        this.plugins.delete(key);
        throw err;
      });
      this.plugins.set(key, all);
    }
    return all;
  }

  /**
   * A resource's JSON schema as this APISIX checks it (GET /apisix/admin/schema/<name>, where name is
   * `route`, `service`, `upstream`, `consumer`, `ssl`, `stream_route`, `global_rule`,
   * `plugin_config`, `proto`, `consumer_group` or `credential`). Fetched once per client and name;
   * a failure is not kept.
   */
  resourceSchema(name: string): Promise<Obj> {
    let schema = this.schemas.get(name);
    if (!schema) {
      schema = this.request('GET', `schema/${encodeURIComponent(name)}`).then(({ body }) => {
        if (!isObj(body)) throw notAdminApi();
        return body;
      });
      schema.catch(() => this.schemas.delete(name));
      this.schemas.set(name, schema);
    }
    return schema;
  }

  /**
   * Whether this APISIX has the kind: false when its list endpoint answers 4xx (404 on versions
   * without it, 400 for stream_routes when stream mode is off). Auth, network and 5xx failures reject.
   */
  async supports(kind: Kind): Promise<boolean> {
    // Credentials have no list of their own, but APISIX 3.11+ routes the bare /credentials path to
    // that resource (answering with a listing) while older versions answer 404 "Unsupported resource type".
    const path = kind === 'credentials' ? 'credentials' : kind;
    try {
      await this.request('GET', path, SMALL_PAGE);
      return true;
    } catch (err) {
      const status = err instanceof ApiError && err.kind !== 'auth' ? err.status : undefined;
      if (status !== undefined && status >= 400 && status < 500) return false;
      throw err;
    }
  }

  private async fetchAllPlugins(subsystem?: 'stream'): Promise<Record<string, PluginInfo>> {
    const { body } = await this.request('GET', 'plugins', subsystem ? { all: 'true', subsystem } : { all: 'true' });
    if (!isObj(body)) throw notAdminApi();
    return body as Record<string, PluginInfo>;
  }

  private async page(kind: Kind, path: string, page: number): Promise<Page> {
    const { body } = await this.request('GET', path, { page: String(page), page_size: String(PAGE_SIZE) });
    return parseList(kind, body);
  }

  private async request(
    method: string,
    path: string,
    query?: Query,
    body?: Obj,
  ): Promise<{ body: unknown; headers: Headers }> {
    const search = query && Object.keys(query).length > 0 ? `?${new URLSearchParams(query).toString()}` : '';
    const headers: Record<string, string> = {};
    if (this.conn.key) headers['X-API-KEY'] = this.conn.key;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let res: Response;
    let text: string;
    try {
      res = await this.fetchImpl(`${this.adminUrl}/${path}${search}`, {
        method,
        headers,
        // The Admin API answers Access-Control-Allow-Origin: *, which browsers only honour without credentials.
        credentials: 'omit',
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      text = await res.text();
    } catch (err) {
      throw new ApiError('network', `Network error: ${err instanceof Error ? err.message : 'request failed'}`, {
        cause: err,
      });
    }

    const status = res.status;
    const parsed = parseJson(text);
    if (status === 401 || status === 403) {
      const errorMsg = apisixMessage(parsed);
      throw new ApiError('auth', httpMessage(status, errorMsg), { status, errorMsg });
    }
    if (parsed === NOT_JSON) throw notAdminApi(status);
    if (!res.ok) {
      const errorMsg = apisixMessage(parsed);
      throw new ApiError('http', httpMessage(status, errorMsg), { status, errorMsg });
    }
    return { body: parsed, headers: res.headers };
  }
}

function collectionPath(kind: Kind, parent?: Parent): string {
  if (kind !== 'credentials') return kind;
  if (!parent) throw new Error('credentials need a parent consumer');
  return `consumers/${encodeURIComponent(parent.consumer)}/credentials`;
}

function itemPath(kind: Kind, id: string, parent?: Parent): string {
  const slash = id.indexOf('/');
  // A secret's ID is <manager>/<id>: two path segments.
  const encoded =
    kind === 'secrets' && slash > 0
      ? `${encodeURIComponent(id.slice(0, slash))}/${encodeURIComponent(id.slice(slash + 1))}`
      : encodeURIComponent(id);
  return `${collectionPath(kind, parent)}/${encoded}`;
}

/** Reads `{total, list}`. An empty list arrives as `{}`: an empty Lua table encodes as a JSON object. */
function parseList(kind: Kind, body: unknown): Page {
  const list = isObj(body) ? body.list : undefined;
  const entries: unknown[] | undefined = Array.isArray(list) ? list : isObj(list) ? Object.values(list) : undefined;
  if (!isObj(body) || !entries) throw notAdminApi();
  const items = entries.map((entry) => toItem(kind, entry));
  return { total: typeof body.total === 'number' ? body.total : items.length, items };
}

/** Reads `{key, value, createdIndex?, modifiedIndex?}`, the shape of list entries and single-object bodies. */
function toItem(kind: Kind, body: unknown): Item {
  if (!isObj(body) || typeof body.key !== 'string' || !isObj(body.value)) throw notAdminApi();
  const item: Item = { id: itemId(kind, body.key, body.value), value: body.value };
  if (typeof body.createdIndex === 'number') item.createdIndex = body.createdIndex;
  if (typeof body.modifiedIndex === 'number') item.modifiedIndex = body.modifiedIndex;
  return item;
}

/** The ID used in URLs. `key` is the etcd key, e.g. /apisix/secrets/vault/my-id. */
function itemId(kind: Kind, key: string, value: Obj): string {
  const segments = key.split('/');
  const last = segments.at(-1) ?? '';
  switch (kind) {
    case 'consumers':
      return scalar(value.username) ?? last;
    case 'plugin_metadata':
      return last;
    case 'secrets':
      return segments.slice(-2).join('/');
    default:
      return scalar(value.id) ?? last;
  }
}

function scalar(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function parseJson(text: string): unknown {
  if (text === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return NOT_JSON;
  }
}

/** APISIX's error_msg (with its description, e.g. "invalid method for role viewer"), or etcd's message. */
function apisixMessage(body: unknown): string | undefined {
  if (!isObj(body)) return undefined;
  const { error_msg: errorMsg, description, message } = body;
  if (typeof errorMsg === 'string') {
    return typeof description === 'string' && description ? `${errorMsg}: ${description}` : errorMsg;
  }
  return typeof message === 'string' ? message : undefined;
}

function httpMessage(status: number, errorMsg?: string): string {
  return errorMsg ? `HTTP ${status}: ${errorMsg}` : `HTTP ${status}`;
}

function notAdminApi(status?: number): ApiError {
  const message = 'not an APISIX Admin API response';
  return new ApiError('parse', status === undefined ? message : `HTTP ${status}: ${message}`, { status });
}
