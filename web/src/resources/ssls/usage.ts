// What an SSL is used for, as APISIX uses it: a server certificate is presented to TLS clients for
// its SNIs (the route hosts below are the ones it is presented for), a client certificate only by
// the upstreams that name it in tls.client_cert_id (upstream.lua 646–665, init.lua 683–700). Pure.
import type { Item, Obj } from '../../api/types';
import type { Ctx } from '../ctx';
import { referenceUse, routeHosts, sslForHost, type Reference } from '../resolve';
import { parseCert, type CertInfo } from './parseCert';
import { isSecretRef } from './validate';

/** `client`, or `server` (also when unset: the schema's default). */
export const typeOf = (ssl: Obj): 'server' | 'client' => (ssl.type === 'client' ? 'client' : 'server');

/** The SNIs as stored, in the order the router reads them: `snis` when it is a non-empty list, else `sni` (radixtree_sni.lua 56–64). */
export function sniNames(ssl: Obj): string[] {
  const list: unknown[] = Array.isArray(ssl.snis) && ssl.snis.length > 0 ? ssl.snis : [ssl.sni];
  return list.filter((s): s is string => typeof s === 'string' && s !== '');
}

/** The main certificate's details, unless it is a reference or our reader can't read it. */
export function certOf(ssl: Obj): CertInfo | undefined {
  return typeof ssl.cert === 'string' && !isSecretRef(ssl.cert) ? parseCert(ssl.cert) : undefined;
}

/**
 * Whether `status` does anything for this SSL: APISIX serves only enabled server certificates
 * (radixtree_sni.lua 51–52), but resolves a client certificate by id whatever its status
 * (init.lua 694–700, router get_by_id).
 */
export const statusApplies = (ssl: Obj): boolean => typeOf(ssl) === 'server';

/** A route host this certificate is presented for; `others`: how many other certificates share its SNI level (APISIX serves the one it loaded first). */
export interface ServedHost {
  host: string;
  others: number;
}

/** Per Ctx (it keeps its identity until a list changes): each SSL id → the route hosts it is presented for. */
const servedByCtx = new WeakMap<Ctx, Map<string, ServedHost[]>>();

function servedMap(ctx: Ctx): Map<string, ServedHost[]> {
  let map = servedByCtx.get(ctx);
  if (map) return map;
  map = new Map();
  const hosts = new Set(ctx.routes.flatMap((route) => routeHosts(route.value, ctx).hosts));
  for (const host of [...hosts].sort()) {
    const match = sslForHost(host, ctx);
    if (!match) continue;
    const others = match.shared.length;
    for (const item of [match.item, ...match.shared]) map.set(item.id, [...(map.get(item.id) ?? []), { host, others }]);
  }
  servedByCtx.set(ctx, map);
  return map;
}

/**
 * The distinct route hosts (a route's own, else its service's: routeHosts) for which APISIX presents
 * this certificate (sslForHost, shared ones included); undefined while routes or services load.
 */
export function servedHosts(item: Item, ctx: Ctx): ServedHost[] | undefined {
  if (!ctx.loaded.routes || !ctx.loaded.services) return undefined;
  return servedMap(ctx).get(item.id) ?? [];
}

/** What uses it; `unknown` when a list it depends on could not be read. */
export type Usage = { type: 'server'; hosts: ServedHost[] } | { type: 'client'; refs: Reference[] } | { type: 'unknown' };

/**
 * What uses the SSL (see the head comment); undefined while a list it depends on loads. A client
 * certificate's users are referenceUse's, so they wait on the one table of lists (resolve.ts).
 */
export function usageOf(item: Item, ctx: Ctx): Usage | undefined {
  if (typeOf(item.value) === 'server') {
    if (ctx.failed.routes || ctx.failed.services) return { type: 'unknown' };
    const hosts = servedHosts(item, ctx);
    return hosts && { type: 'server', hosts };
  }
  const use = referenceUse('ssls', item.id, ctx);
  if ('failed' in use) return { type: 'unknown' };
  return 'refs' in use ? { type: 'client', refs: use.refs } : undefined;
}

/** How many things use it (route hosts, or referrers); undefined while loading or unknown. */
export function usageCount(item: Item, ctx: Ctx): number | undefined {
  const usage = usageOf(item, ctx);
  if (!usage || usage.type === 'unknown') return undefined;
  return usage.type === 'server' ? usage.hosts.length : usage.refs.length;
}

/** A distinguished name's CN, else its O (`C=US, O=Let's Encrypt, CN=R3` → `R3`); the whole name when it has neither. */
export function shortName(dn: string | undefined): string | undefined {
  if (dn === undefined) return undefined;
  const part = (attr: string) => dn.split(', ').find((p) => p.startsWith(`${attr}=`))?.slice(attr.length + 1);
  return part('CN') ?? part('O') ?? dn;
}
