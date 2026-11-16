// Pure lookups over the Ctx lists: no React, no hooks. Each rule follows how APISIX itself resolves
// the object at request time (file names below are in the APISIX source).
import { isObj } from '../api/sanitize';
import type { Item, Kind, Obj, PluginInfo } from '../api/types';
import { t } from '../i18n';
import { entryEffect } from '../plugins/entryEffect';
import { runsOnStream } from '../plugins/stream';
import type { Ctx, CtxList } from './ctx';
import { parseCert } from './ssls/parseCert';

export interface UpstreamSummary {
  label: string;
  /** `host:port` (or the bare host when the node has no port); empty for a discovery upstream. */
  nodes: string[];
  source: 'inline' | 'upstream' | 'service' | 'none' | 'missing';
  /** The upstream id (source `upstream`, `missing`) or the service id (source `service`). */
  refId?: string;
}

export interface EffectivePlugin {
  name: string;
  from: 'route' | 'service' | 'plugin_config';
  /** `_meta.disable`: APISIX skips it for this object. Never for a `noEffect` entry. */
  disabled: boolean;
  /** A plugin APISIX runs for the whole instance (entryEffect): this entry does nothing here, on or off. */
  noEffect?: boolean;
}

export interface SslMatch {
  item: Item;
  /** Milliseconds since the epoch. */
  notAfter?: number;
  /**
   * Other certificates the SNI router puts level with `item` for this host (the same SNI, or the same
   * longest wildcard). APISIX serves whichever of them it loaded first, which the dashboard can't
   * know: `item` is only the first in the list's order (etcd key order, APISIX's own after a restart).
   */
  shared: Item[];
}

export interface Reference {
  kind: Kind;
  id: string;
  name: string;
}

/** An id as APISIX may store it (some come back as numbers), as a string; undefined when unset. */
function idOf(value: unknown): string | undefined {
  if (typeof value === 'number') return String(value);
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** Each list's items by id (the first of a repeated id), built once per list: the lists are replaced, never changed in place. */
const indexes = new WeakMap<Item[], Map<string, Item>>();

function find(items: Item[], id: string | undefined): Item | undefined {
  if (id === undefined) return undefined;
  let index = indexes.get(items);
  if (!index) {
    index = new Map();
    for (const item of items) if (!index.has(String(item.id))) index.set(String(item.id), item);
    indexes.set(items, index);
  }
  return index.get(id);
}

/** A nested field, or undefined as soon as a step is not an object. */
function dig(value: unknown, ...path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isObj(current)) return undefined;
    current = current[key];
  }
  return current;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v !== '') : [];
}

const compareText = (a: string, b: string): number => a.localeCompare(b);

/** The display name the registry's nameOf uses, before its fallback to the id: name, username, desc. */
export function nameOfValue(value: Obj): string | undefined {
  return nonEmpty(value.name) ?? nonEmpty(value.username) ?? nonEmpty(value.desc);
}

const itemName = (item: Item): string => nameOfValue(item.value) ?? item.id;

/** Routes and SSLs: `status` 0 is off; anything else, a missing status included, is on (APISIX's default is 1). */
export function isEnabled(value: Obj): boolean {
  return value.status !== 0;
}

/** The Ctx list each kind it carries lives in. */
const CTX_LISTS = {
  routes: 'routes',
  stream_routes: 'streamRoutes',
  services: 'services',
  upstreams: 'upstreams',
  ssls: 'ssls',
  plugin_configs: 'pluginConfigs',
  consumer_groups: 'consumerGroups',
  consumers: 'consumers',
} as const satisfies Partial<Record<Kind, keyof Ctx>>;

/** Kinds whose objects the Ctx holds, so a reference to one can be resolved. */
export type CtxKind = keyof typeof CTX_LISTS;

export interface RefTarget {
  id: string;
  /** Undefined when no object has the id: a dangling reference. */
  item?: Item;
}

/** The object of `kind` with this id in the Ctx, once its list has loaded; undefined for a kind the Ctx doesn't hold. */
export function findInCtx(kind: Kind, id: string, ctx: Ctx): Item | undefined {
  const list = (CTX_LISTS as Partial<Record<Kind, keyof Ctx & keyof Ctx['loaded']>>)[kind];
  return list && ctx.loaded[list] ? find(ctx[list], id) : undefined;
}

/** What a reference field (`service_id`, `plugin_config_id`, `upstream_id`, …) points at; undefined when unset. */
export function resolveRef(kind: CtxKind, value: unknown, ctx: Ctx): RefTarget | undefined {
  const id = idOf(value);
  return id === undefined ? undefined : { id, item: find(ctx[CTX_LISTS[kind]], id) };
}

/** `labels` as [key, value] pairs, in stored order; anything but a string value is skipped. */
export function labelPairs(labels: unknown): [string, string][] {
  if (!isObj(labels)) return [];
  return Object.entries(labels).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
}

/** The route's own `hosts` / `host`, else its service's `hosts` (apisix/http/route.lua). */
export function routeHosts(route: Obj, ctx: Ctx): { hosts: string[]; viaService: boolean } {
  const own = strings(route.hosts);
  if (own.length > 0) return { hosts: own, viaService: false };
  const host = nonEmpty(route.host);
  if (host !== undefined) return { hosts: [host], viaService: false };
  const inherited = strings(find(ctx.services, idOf(route.service_id))?.value.hosts);
  return { hosts: inherited, viaService: inherited.length > 0 };
}

/** A route that sets no hosts of its own and takes them from a service. */
const hostsFromService = (route: Obj): boolean => strings(route.hosts).length === 0 && nonEmpty(route.host) === undefined && idOf(route.service_id) !== undefined;

/**
 * Whether a route's hosts can't be known yet: it sets none of its own and takes them from a service
 * whose list has not loaded (until then "any host" would be a guess: addendum rule 12), nor failed.
 */
export function routeHostsLoading(route: Obj, ctx: Ctx): boolean {
  return hostsFromService(route) && !ctx.loaded.services && !ctx.failed.services;
}

/** Whether a route's hosts can't be known at all: they come from a service, and the services read failed (Task 16b, item 162). */
export function routeHostsUnknown(route: Obj, ctx: Ctx): boolean {
  return hostsFromService(route) && ctx.failed.services;
}

function discoveryOf(upstream: Obj): string | undefined {
  const type = nonEmpty(upstream.discovery_type);
  const service = nonEmpty(upstream.service_name);
  return type !== undefined && service !== undefined ? `${type}:${service}` : undefined;
}

function address(node: Obj): string | undefined {
  const host = nonEmpty(node.host);
  if (host === undefined || typeof node.port !== 'number') return host;
  return `${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${node.port}`;
}

/** Nodes come as a map `{ "host:port": weight }` or an array of `{ host, port, weight }`. */
function nodesOf(upstream: Obj): string[] {
  if (discoveryOf(upstream) !== undefined) return [];
  const { nodes } = upstream;
  if (Array.isArray(nodes)) return nodes.flatMap((node) => (isObj(node) ? (address(node) ?? []) : []));
  return isObj(nodes) ? Object.keys(nodes) : [];
}

/** `name` is the referenced object's name; then the discovery service, then the nodes. */
function summarise(upstream: Obj, name: string | undefined): { label: string; nodes: string[] } {
  const nodes = nodesOf(upstream);
  const [first] = nodes;
  const fromNodes = first === undefined ? t('ui.empty') : nodes.length > 1 ? `${first} +${nodes.length - 1}` : first;
  return { label: name ?? discoveryOf(upstream) ?? fromNodes, nodes };
}

/** The subsystem a route runs in: http (routes) or stream (stream routes); they read a service's upstream differently. */
export type Subsystem = 'http' | 'stream';

/**
 * An object's own upstream: by default upstream_id over the inline one (with both set, APISIX
 * proxies to upstream_id: handle_upstream in apisix/init.lua 724–733, stream_preread_phase 1894);
 * `inlineFirst` the other way round, as the stream subsystem reads a service's (see upstreamSummary).
 */
export function ownUpstream(obj: Obj, ctx: Ctx, inlineFirst = false): UpstreamSummary | undefined {
  const inline: UpstreamSummary | undefined = isObj(obj.upstream) ? { ...summarise(obj.upstream, undefined), source: 'inline' } : undefined;
  if (inlineFirst && inline) return inline;
  const upstreamId = idOf(obj.upstream_id);
  if (upstreamId !== undefined) {
    const upstream = find(ctx.upstreams, upstreamId);
    if (!upstream) return { label: t('ui.empty'), nodes: [], source: 'missing', refId: upstreamId };
    return { ...summarise(upstream.value, nonEmpty(upstream.value.name)), source: 'upstream', refId: upstreamId };
  }
  return inline;
}

/**
 * Where a route, stream route or service proxies to: its own upstream_id or inline upstream, else
 * (routes and stream routes) its service's. A service with both is read per subsystem: a route
 * (http) takes its upstream_id (merge_service_route keeps both, and handle_upstream reads
 * upstream_id first: apisix/plugin.lua 705–731, init.lua 724–733); a stream route its inline
 * upstream (merge_service_stream_route copies it when the route has none, plugin.lua 793–799, and
 * stream_preread_phase reads upstream_id only without one, init.lua 1922–1934).
 */
export function upstreamSummary(object: Obj, ctx: Ctx, subsystem: Subsystem = 'http'): UpstreamSummary {
  const obj = subsystem === 'stream' ? asStreamRoute(object) : object;
  const own = ownUpstream(obj, ctx);
  if (own) return own;
  const service = find(ctx.services, idOf(obj.service_id));
  const inherited = service && ownUpstream(service.value, ctx, subsystem === 'stream');
  if (!service || !inherited) return { label: t('ui.empty'), nodes: [], source: 'none' };
  // The service's upstream_id points nowhere: APISIX answers 502, so report the missing upstream.
  if (inherited.source === 'missing') return inherited;
  const label = nonEmpty(service.value.name) ?? inherited.label;
  return { label, nodes: inherited.nodes, source: 'service', refId: service.id };
}

/**
 * The plugins that run for a route, one per name. APISIX fills the route's plugins from its plugin
 * config, then lays them over the service's (apisix/plugin_config.lua merge, then
 * merge_service_route), so the route wins over the plugin config, which wins over the service.
 * `all` is the plugin list where it is in hand, for entryEffect (a custom plugin it reports as
 * `scope: "global"` has no effect as an entry); without it the built-in names decide.
 */
export function effectivePlugins(route: Obj, ctx: Ctx, all?: Record<string, PluginInfo>): EffectivePlugin[] {
  const layers: [EffectivePlugin['from'], unknown][] = [
    ['route', route.plugins],
    ['plugin_config', find(ctx.pluginConfigs, idOf(route.plugin_config_id))?.value.plugins],
    ['service', find(ctx.services, idOf(route.service_id))?.value.plugins],
  ];
  const byName = new Map<string, EffectivePlugin>();
  for (const [from, plugins] of layers) {
    if (!isObj(plugins)) continue;
    for (const [name, conf] of Object.entries(plugins)) {
      if (byName.has(name)) continue;
      const effect = entryEffect(name, conf, all?.[name]);
      byName.set(name, effect === 'noEffect' ? { name, from, disabled: false, noEffect: true } : { name, from, disabled: effect === 'off' });
    }
  }
  return [...byName.values()].sort((a, b) => compareText(a.name, b.name));
}

/**
 * Whose script runs for an HTTP route instead of every plugin: its own, else its service's. APISIX
 * copies the service into the route, the route's script over the service's (merge_service_route,
 * apisix/plugin.lua 705–735), and a merged route with a script runs it and none of its own, its
 * plugin config's or its service's plugins (apisix/init.lua 1064–1070). `loading` while the services
 * have not loaded, `unknown` when their read failed; undefined when no script runs. Never for a stream
 * route: the stream subsystem merges only plugins and upstream from a service
 * (merge_service_stream_route, apisix/plugin.lua 775–802) and loads no script.
 */
export function routeScript(route: Obj, ctx: Ctx): 'route' | 'service' | 'loading' | 'unknown' | undefined {
  if (route.script !== undefined) return 'route';
  const id = idOf(route.service_id);
  if (id === undefined) return undefined;
  if (!ctx.loaded.services) return ctx.failed.services ? 'unknown' : 'loading';
  return find(ctx.services, id)?.value.script !== undefined ? 'service' : undefined;
}

/**
 * A stream route with only what the stream subsystem merges into it. stream_preread_phase merges a
 * route with its service (merge_service_stream_route: the service's plugins it doesn't set, and the
 * service's upstream when it has none) only when the route has no upstream_id of its own; with one,
 * neither its service's plugins nor its upstream apply (apisix/init.lua 1894–1907, 1947). A stream
 * route has no plugin config. Used for every view of a stream route: its plugins, its inherited
 * list, its upstream.
 */
export function asStreamRoute(route: Obj): Obj {
  const merged = idOf(route.upstream_id) === undefined;
  return { ...route, plugin_config_id: undefined, ...(merged ? {} : { service_id: undefined }) };
}

/**
 * The plugins that run for a stream route: its own, then those of its service that it merges and
 * doesn't set (asStreamRoute), of those only what the stream subsystem runs (plugin.stream_filter,
 * apisix/plugin.lua 675–702: runsOnStream), sorted by name.
 */
export function streamEffectivePlugins(route: Obj, ctx: Ctx, all?: Record<string, PluginInfo>): EffectivePlugin[] {
  return effectivePlugins(asStreamRoute(route), ctx, all).filter((p) => runsOnStream(p.name));
}

/** An SNI as APISIX compares it: lower case, without a trailing dot (ssl.lua 68–69; radixtree_sni.lua 293–301 for stored ones). */
const normalSni = (sni: string): string => sni.replace(/\.$/, '').toLowerCase();

/**
 * The SNIs the router serves an SSL for: `snis` when it is a non-empty list, else `sni`
 * (radixtree_sni.lua 56–64), normalised (normalSni). Empty for neither.
 */
export function sniList(ssl: Obj): string[] {
  const list: unknown[] = Array.isArray(ssl.snis) && ssl.snis.length > 0 ? ssl.snis : [ssl.sni];
  return list.filter((s): s is string => typeof s === 'string' && s !== '').map(normalSni);
}

/**
 * Whether the SNI router serves this SSL to TLS clients at all: an enabled server certificate
 * (radixtree_sni.lua 51–52). A missing type is `server`, the schema's default, which APISIX applies
 * when it loads the object (checked live: an SSL stored without a type is served).
 */
export function servedToClients(ssl: Obj): boolean {
  return (ssl.type === undefined || ssl.type === 'server') && isEnabled(ssl);
}

const reversed = (text: string): string => [...text].reverse().join('');

/** An enabled server SSL as the router holds it: its SNIs reversed, and whether it has the single `sni`. */
interface SniRoute {
  item: Item;
  paths: string[];
  single: boolean;
}

/**
 * The SSLs at the level of the SNI router that `name` (reversed) reaches: those with an exact path
 * equal to it; else those whose wildcard prefix is the longest one it starts with. resty.radixtree
 * looks the exact paths up first (hash_path), then walks the prefixes from the longest down
 * (radix_tree_search / radix_tree_up) and takes the first route of the first level that has one, in
 * insertion order (radixtree.lua match_route, insert_route with sort_route). A reversed SNI's `*` is
 * its last character, so everything before it is the prefix (pre_insert_route: path_op "<=").
 */
function levelOf(name: string, routes: SniRoute[]): SniRoute[] {
  const exact = routes.filter((r) => r.paths.some((p) => !p.includes('*') && p === name));
  if (exact.length > 0) return exact;
  let longest = -1;
  let level: SniRoute[] = [];
  for (const r of routes) {
    for (const p of r.paths) {
      const star = p.indexOf('*');
      if (star < 0 || !name.startsWith(p.slice(0, star))) continue;
      if (star > longest) [longest, level] = [star, [r]];
      else if (star === longest && !level.includes(r)) level.push(r);
    }
  }
  return level;
}

/**
 * The check the SNI router makes after the match (radixtree_sni.lua 188–215), which never sends it
 * back for another certificate: a single `sni` of `*` takes any name; otherwise the name must equal
 * one of the SSL's reversed SNIs or have no dot from that SNI's length on (Lua's 1-based
 * `find(name, ".", #sni)`), which is what limits a wildcard to one label, and lets a long name in the
 * same list wave deeper names through.
 */
function passes(route: SniRoute, name: string): boolean {
  const noDotFrom = (path: string): boolean => name.indexOf('.', path.length - 1) < 0;
  const [first = ''] = route.paths;
  if (route.single) return first === '*' || noDotFrom(first);
  return route.paths.some((p) => p === name || noDotFrom(p));
}

/** A literal address, which a client never sends as SNI (RFC 6066 section 3). */
const ADDRESS = /^\d{1,3}(\.\d{1,3}){3}$|:/;

/** A wildcard route host stands for a name under it that no exact SNI has: `*` becomes a character no SNI may hold. */
const ANY_LABEL = '\u0000';

/**
 * APISIX before 3.7 stored the certificate's expiry as `validity_end`, in seconds; 3.7 removed the
 * field, so read it from the certificate itself (parseCert is memoised per PEM).
 */
export function sslNotAfter(ssl: Obj): number | undefined {
  const end = ssl.validity_end;
  if (typeof end === 'number' && Number.isFinite(end)) return end * 1000;
  return typeof ssl.cert === 'string' ? parseCert(ssl.cert)?.notAfter : undefined;
}

/**
 * The certificate APISIX presents for `host` (as a route writes it; a wildcard host stands for a
 * name under it), following the SNI router: only enabled server certificates (servedToClients), an
 * exact SNI before a wildcard, the longest wildcard first, then its check (passes). None for an
 * address, for which a client sends no SNI (ssl.lua 42–71: no fallback_sni is assumed). Certificates
 * level with the first one are `shared`; one that the check would refuse is left out of them (it
 * takes a long SNI next to a wildcard in only one of them).
 */
export function sslForHost(host: string, ctx: Ctx): SslMatch | undefined {
  if (ADDRESS.test(host)) return undefined;
  const name = reversed(normalSni(host.startsWith('*') ? `${ANY_LABEL}${host.slice(1)}` : host));
  const routes = ctx.ssls
    .filter((item) => servedToClients(item.value))
    .map((item) => ({ item, paths: sniList(item.value).map(reversed), single: !(Array.isArray(item.value.snis) && item.value.snis.length > 0) }));
  const [first, ...others] = levelOf(name, routes).filter((r) => passes(r, name));
  return first && { item: first.item, notAfter: sslNotAfter(first.item.value), shared: others.map((r) => r.item) };
}

/** The expiries (ms) of every certificate a match may present: its own, then the shared ones'. */
export function sslExpiries(match: SslMatch | undefined): (number | undefined)[] {
  return match ? [match.notAfter, ...match.shared.map((item) => sslNotAfter(item.value))] : [];
}

/** Upstream ids in a traffic-split plugin's rules. */
function splitUpstreamIds(plugins: unknown): unknown[] {
  const rules = dig(plugins, 'traffic-split', 'rules');
  if (!Array.isArray(rules)) return [];
  return rules.flatMap((rule) => {
    const weighted = dig(rule, 'weighted_upstreams');
    return Array.isArray(weighted) ? weighted.map((w) => dig(w, 'upstream_id')) : [];
  });
}

/**
 * For every object of `kind` the lists point at, the objects pointing at it, each sorted by kind then
 * name: one pass over each list it reads (REFERENCE_LISTS), whatever the number of objects asked
 * about. An object pointing at one id twice (an upstream_id and a traffic-split rule) is listed once.
 */
function referencesByTarget(kind: Kind, ctx: Ctx): Map<string, Reference[]> {
  const index = new Map<string, Reference[]>();
  const collect = (from: Kind, items: Item[], targets: (value: Obj) => unknown[]): void => {
    for (const item of items) {
      const ids = new Set(targets(item.value).map(idOf).filter((id): id is string => id !== undefined));
      for (const id of ids) {
        const refs = index.get(id) ?? [];
        refs.push({ kind: from, id: item.id, name: itemName(item) });
        index.set(id, refs);
      }
    }
  };

  switch (kind) {
    case 'upstreams': {
      // APISIX also refuses to delete an upstream a traffic-split rule points at, in a global rule too
      // (apisix/admin/upstreams.lua delete_checker, 90–129; global rules 123–126).
      const inSplit = (v: Obj): unknown[] => splitUpstreamIds(v.plugins);
      const direct = (v: Obj): unknown[] => [v.upstream_id, ...inSplit(v)];
      collect('routes', ctx.routes, direct);
      collect('services', ctx.services, direct);
      collect('stream_routes', ctx.streamRoutes, (v) => [v.upstream_id]);
      collect('plugin_configs', ctx.pluginConfigs, inSplit);
      collect('consumers', ctx.consumers, inSplit);
      collect('consumer_groups', ctx.consumerGroups, inSplit);
      collect('global_rules', ctx.globalRules, inSplit);
      break;
    }
    case 'services':
      collect('routes', ctx.routes, (v) => [v.service_id]);
      collect('stream_routes', ctx.streamRoutes, (v) => [v.service_id]);
      break;
    case 'plugin_configs':
      collect('routes', ctx.routes, (v) => [v.plugin_config_id]);
      break;
    case 'stream_routes':
      // A stream route another names as its protocol's superior (xRPC): APISIX refuses the delete
      // (apisix/admin/stream_routes.lua 150–152, tostring(superior_id) == id).
      collect('stream_routes', ctx.streamRoutes, (v) => [dig(v, 'protocol', 'superior_id')]);
      break;
    case 'consumer_groups':
      collect('consumers', ctx.consumers, (v) => [v.group_id]);
      break;
    case 'ssls': {
      // An inline upstream can name a client certificate just like a stored one.
      const inline = (v: Obj): unknown[] => [dig(v, 'upstream', 'tls', 'client_cert_id')];
      collect('upstreams', ctx.upstreams, (v) => [dig(v, 'tls', 'client_cert_id')]);
      collect('routes', ctx.routes, inline);
      collect('services', ctx.services, inline);
      collect('stream_routes', ctx.streamRoutes, inline);
      break;
    }
    case 'protos': {
      // APISIX's delete check looks at routes and services (admin/proto.lua 61–101); the others use it
      // too, through grpc-transcode wherever it is configured (protoDeleteBlockers).
      const uses = (v: Obj): unknown[] => [dig(v, 'plugins', 'grpc-transcode', 'proto_id')];
      collect('routes', ctx.routes, uses);
      collect('services', ctx.services, uses);
      collect('plugin_configs', ctx.pluginConfigs, uses);
      collect('consumers', ctx.consumers, uses);
      collect('consumer_groups', ctx.consumerGroups, uses);
      collect('global_rules', ctx.globalRules, uses);
      break;
    }
    default:
      break;
  }
  for (const refs of index.values()) refs.sort((a, b) => compareText(a.kind, b.kind) || compareText(a.name, b.name) || compareText(a.id, b.id));
  return index;
}

/** The objects whose fields point at `kind` / `id`, sorted by kind then name. Kinds nothing points at give []. */
export function referencesTo(kind: Kind, id: string, ctx: Ctx): Reference[] {
  return referencesByTarget(kind, ctx).get(id) ?? [];
}

/**
 * The Ctx lists referencesTo reads for each kind (a kind not here is pointed at by nothing it knows
 * of): the one table every "what uses it" waits on (referenceUse, the Used-by columns, Delete). A test
 * runs referencesTo for every kind and compares the lists it reads with this table.
 */
const REFERENCE_LISTS: Partial<Record<Kind, CtxList[]>> = {
  upstreams: ['routes', 'services', 'streamRoutes', 'pluginConfigs', 'consumers', 'consumerGroups', 'globalRules'],
  services: ['routes', 'streamRoutes'],
  plugin_configs: ['routes'],
  consumer_groups: ['consumers'],
  ssls: ['upstreams', 'routes', 'services', 'streamRoutes'],
  protos: ['routes', 'services', 'pluginConfigs', 'consumers', 'consumerGroups', 'globalRules'],
  stream_routes: ['streamRoutes'],
};

/** The kind each Ctx list holds. */
const LIST_KINDS: Record<CtxList, Kind> = {
  routes: 'routes',
  streamRoutes: 'stream_routes',
  services: 'services',
  upstreams: 'upstreams',
  ssls: 'ssls',
  pluginConfigs: 'plugin_configs',
  consumerGroups: 'consumer_groups',
  consumers: 'consumers',
  globalRules: 'global_rules',
};

/** The lists that can point at an object of `kind` (REFERENCE_LISTS); none for a kind nothing points at. */
export const referenceLists = (kind: Kind): readonly CtxList[] => REFERENCE_LISTS[kind] ?? [];

/** What uses an object: its references, `loading` while a list they come from has not loaded, or the kinds of the lists that `failed`. */
export type ReferenceUse = { refs: Reference[] } | { loading: true } | { failed: Kind[] };

/**
 * What uses `kind` / `id` (referencesTo), once every list it reads for that kind has loaded: until
 * then it can't be told (addendum rule 12), and a list that failed leaves it unknown.
 */
export function referenceUse(kind: Kind, id: string, ctx: Ctx): ReferenceUse {
  return referenceIndex(kind, ctx)(id);
}

/**
 * referenceUse for any object of `kind` in this context, from one reverse index (referencesByTarget):
 * build it once for a context, then ask it per object (the bulk Delete confirmation over many).
 */
export function referenceIndex(kind: Kind, ctx: Ctx): (id: string) => ReferenceUse {
  const lists = referenceLists(kind);
  const failed = lists.filter((list) => ctx.failed[list]);
  if (failed.length > 0) {
    const use: ReferenceUse = { failed: failed.map((list) => LIST_KINDS[list]) };
    return () => use;
  }
  if (!lists.every((list) => ctx.loaded[list])) return () => ({ loading: true });
  const byTarget = referencesByTarget(kind, ctx);
  return (id) => ({ refs: byTarget.get(id) ?? [] });
}
