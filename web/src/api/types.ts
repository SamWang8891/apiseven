/** Resource types of the APISIX Admin API, named as in its URL paths. */
export type Kind =
  | 'routes'
  | 'services'
  | 'upstreams'
  | 'consumers'
  | 'credentials'
  | 'consumer_groups'
  | 'ssls'
  | 'global_rules'
  | 'plugin_configs'
  | 'plugin_metadata'
  | 'protos'
  | 'secrets'
  | 'stream_routes';

export type Obj = Record<string, unknown>;

/** One stored object. `id` is the ID used in its URL (see client.ts for the per-kind rule). */
export interface Item<T = Obj> {
  id: string;
  value: T;
  modifiedIndex?: number;
  createdIndex?: number;
}

/** An APISIX instance. `baseUrl` ends before /apisix/admin; it may be '' or a path prefix (same-origin proxy). */
export interface Connection {
  id: string;
  name: string;
  baseUrl: string;
  key?: string;
}

/** The owning consumer; only for kind 'credentials'. */
export interface Parent {
  consumer: string;
}

/** One entry of GET /apisix/admin/plugins?all=true. */
export interface PluginInfo {
  schema: Obj;
  consumer_schema?: Obj;
  metadata_schema?: Obj;
  priority?: number;
  type?: string;
  scope?: string;
}
