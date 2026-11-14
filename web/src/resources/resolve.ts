// Pure lookups over the Ctx lists: no React, no hooks. Each rule follows how APISIX itself resolves
// the object at request time (file names below are in the APISIX source).
import { isObj } from '../api/sanitize';
import type { Item, Kind, Obj } from '../api/types';
import { t } from '../i18n';
import type { Ctx } from './ctx';

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
  disabled: boolean;
}

export interface SslMatch {
  item: Item;
  /** Milliseconds since the epoch. */
  notAfter?: number;
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

function find(items: Item[], id: string | undefined): Item | undefined {
  return id === undefined ? undefined : items.find((item) => String(item.id) === id);
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

/** The route's own `hosts` / `host`, else its service's `hosts` (apisix/http/route.lua). */
export function routeHosts(route: Obj, ctx: Ctx): { hosts: string[]; viaService: boolean } {
  const own = strings(route.hosts);
  if (own.length > 0) return { hosts: own, viaService: false };
  const host = nonEmpty(route.host);
  if (host !== undefined) return { hosts: [host], viaService: false };
  const inherited = strings(find(ctx.services, idOf(route.service_id))?.value.hosts);
  return { hosts: inherited, viaService: inherited.length > 0 };
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

function ownUpstream(obj: Obj, ctx: Ctx): UpstreamSummary | undefined {
  // With both set, APISIX proxies to upstream_id and ignores the inline upstream (handle_upstream in apisix/init.lua).
  const upstreamId = idOf(obj.upstream_id);
  if (upstreamId !== undefined) {
    const upstream = find(ctx.upstreams, upstreamId);
    if (!upstream) return { label: t('ui.empty'), nodes: [], source: 'missing', refId: upstreamId };
    return { ...summarise(upstream.value, nonEmpty(upstream.value.name)), source: 'upstream', refId: upstreamId };
  }
  return isObj(obj.upstream) ? { ...summarise(obj.upstream, undefined), source: 'inline' } : undefined;
}

/**
 * Where a route, stream route or service proxies to: its own upstream_id or inline upstream, else
 * (routes and stream routes) its service's (merge_service_route in apisix/plugin.lua).
 */
export function upstreamSummary(obj: Obj, ctx: Ctx): UpstreamSummary {
  const own = ownUpstream(obj, ctx);
  if (own) return own;
  const service = find(ctx.services, idOf(obj.service_id));
  const inherited = service && ownUpstream(service.value, ctx);
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
 */
export function effectivePlugins(route: Obj, ctx: Ctx): EffectivePlugin[] {
  const layers: [EffectivePlugin['from'], unknown][] = [
    ['route', route.plugins],
    ['plugin_config', find(ctx.pluginConfigs, idOf(route.plugin_config_id))?.value.plugins],
    ['service', find(ctx.services, idOf(route.service_id))?.value.plugins],
  ];
  const byName = new Map<string, EffectivePlugin>();
  for (const [from, plugins] of layers) {
    if (!isObj(plugins)) continue;
    for (const [name, conf] of Object.entries(plugins)) {
      if (!byName.has(name)) byName.set(name, { name, from, disabled: dig(conf, '_meta', 'disable') === true });
    }
  }
  return [...byName.values()].sort((a, b) => compareText(a.name, b.name));
}

/** `*.example.org` covers exactly one more label: `a.example.org`, not `a.b.example.org` or `example.org`. */
function wildcardCovers(sni: string, host: string): boolean {
  if (!sni.startsWith('*.')) return false;
  const suffix = sni.slice(1);
  if (!host.endsWith(suffix)) return false;
  const label = host.slice(0, -suffix.length);
  return label !== '' && !label.includes('.');
}

/** 2 for an exact SNI, 1 for a covering wildcard, 0 when the certificate is not served for the host. */
function sniRank(ssl: Obj, host: string): number {
  // APISIX serves only enabled server certificates (apisix/ssl/router/radixtree_sni.lua).
  if (ssl.type === 'client' || ssl.status === 0) return 0;
  const sni = nonEmpty(ssl.sni);
  const snis = [...strings(ssl.snis), ...(sni === undefined ? [] : [sni])].map((s) => s.toLowerCase());
  if (snis.includes(host)) return 2;
  return snis.some((s) => wildcardCovers(s, host)) ? 1 : 0;
}

/** APISIX before 3.7 stored the certificate's expiry as `validity_end`, in seconds; 3.7 removed the field. */
function notAfterOf(ssl: Obj): number | undefined {
  const end = ssl.validity_end;
  return typeof end === 'number' && Number.isFinite(end) ? end * 1000 : undefined;
}

/** The certificate APISIX would present for `host`: an exact SNI beats a wildcard, then the later expiry wins. */
export function sslForHost(host: string, ctx: Ctx): SslMatch | undefined {
  const wanted = host.toLowerCase();
  let best: (SslMatch & { rank: number }) | undefined;
  for (const item of ctx.ssls) {
    const rank = sniRank(item.value, wanted);
    if (rank === 0) continue;
    const notAfter = notAfterOf(item.value);
    const later = (notAfter ?? -Infinity) > (best?.notAfter ?? -Infinity);
    if (!best || rank > best.rank || (rank === best.rank && later)) best = { item, notAfter, rank };
  }
  return best && { item: best.item, notAfter: best.notAfter };
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

/** The objects whose fields point at `kind` / `id`, sorted by kind then name. Kinds nothing points at give []. */
export function referencesTo(kind: Kind, id: string, ctx: Ctx): Reference[] {
  const refs: Reference[] = [];
  const is = (value: unknown): boolean => idOf(value) === id;
  const collect = (from: Kind, items: Item[], uses: (value: Obj) => boolean): void => {
    for (const item of items) if (uses(item.value)) refs.push({ kind: from, id: item.id, name: itemName(item) });
  };

  switch (kind) {
    case 'upstreams': {
      // APISIX also refuses to delete an upstream a traffic-split rule points at (apisix/admin/upstreams.lua).
      const inSplit = (v: Obj): boolean => splitUpstreamIds(v.plugins).some(is);
      const direct = (v: Obj): boolean => is(v.upstream_id) || inSplit(v);
      collect('routes', ctx.routes, direct);
      collect('services', ctx.services, direct);
      collect('stream_routes', ctx.streamRoutes, (v) => is(v.upstream_id));
      collect('plugin_configs', ctx.pluginConfigs, inSplit);
      collect('consumers', ctx.consumers, inSplit);
      collect('consumer_groups', ctx.consumerGroups, inSplit);
      break;
    }
    case 'services':
      collect('routes', ctx.routes, (v) => is(v.service_id));
      collect('stream_routes', ctx.streamRoutes, (v) => is(v.service_id));
      break;
    case 'plugin_configs':
      collect('routes', ctx.routes, (v) => is(v.plugin_config_id));
      break;
    case 'consumer_groups':
      collect('consumers', ctx.consumers, (v) => is(v.group_id));
      break;
    case 'ssls': {
      // An inline upstream can name a client certificate just like a stored one.
      const inline = (v: Obj): boolean => is(dig(v, 'upstream', 'tls', 'client_cert_id'));
      collect('upstreams', ctx.upstreams, (v) => is(dig(v, 'tls', 'client_cert_id')));
      collect('routes', ctx.routes, inline);
      collect('services', ctx.services, inline);
      collect('stream_routes', ctx.streamRoutes, inline);
      break;
    }
    case 'protos': {
      const uses = (v: Obj): boolean => is(dig(v, 'plugins', 'grpc-transcode', 'proto_id'));
      collect('routes', ctx.routes, uses);
      collect('services', ctx.services, uses);
      collect('plugin_configs', ctx.pluginConfigs, uses);
      break;
    }
    default:
      break;
  }
  return refs.sort((a, b) => compareText(a.kind, b.kind) || compareText(a.name, b.name) || compareText(a.id, b.id));
}
