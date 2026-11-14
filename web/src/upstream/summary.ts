// One line per section of the upstream form: what a collapsed section, or the locked overview,
// says about its values. Pure; reads only the upstream object.
import { isObj } from '../api/sanitize';
import type { Obj } from '../api/types';
import { t } from '../i18n';
import { addrOf, rowsOf, usesDiscovery } from './nodes';
import { balancerLabel, DEFAULT_TYPE, type SectionId } from './meta';

/** Addresses listed before `+N`. */
const LISTED = 3;

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const obj = (v: unknown): Obj => (isObj(v) ? v : {});

/** `2 nodes: a:80, b:80`, `consul discovery: web`, or "No nodes". */
export function nodesSummary(up: Obj): string {
  if (usesDiscovery(up)) return t('up.sum.discovery', { type: str(up.discovery_type) ?? '?', service: str(up.service_name) ?? '?' });
  const addresses = rowsOf(up.nodes).map((row) => row.addr ?? addrOf(row.host ?? '?', row.port));
  if (addresses.length === 0) return t('up.sum.noNodes');
  const shown = addresses.slice(0, LISTED).join(', ');
  const list = addresses.length > LISTED ? `${shown} +${addresses.length - LISTED}` : shown;
  return addresses.length === 1 ? t('up.sum.nodesOne', { list }) : t('up.sum.nodesMany', { count: addresses.length, list });
}

/** `Round robin`, `Consistent hash on header X-User-Id`, `…, slow start 30s`. */
export function balancingSummary(up: Obj): string {
  const type = str(up.type) ?? DEFAULT_TYPE;
  let text = balancerLabel(type);
  if (type === 'chash') {
    const on = str(up.hash_on) ?? 'vars';
    text = t('up.sum.hash', { type: text, on, key: on === 'consumer' ? '' : (str(up.key) ?? '?') }).trim();
  }
  const warm = num(obj(up.warm_up_conf).slow_start_time_seconds);
  return isObj(up.warm_up_conf) ? `${text}, ${t('up.sum.slowStart', { seconds: warm ?? '?' })}` : text;
}

/** `Off`, `Active: HTTP GET /health`, `Active: TCP; passive`. */
export function healthSummary(up: Obj): string {
  const checks = obj(up.checks);
  if (!isObj(checks.active)) return isObj(checks.passive) ? t('up.sum.passive') : t('ui.off');
  const active = checks.active;
  const type = str(active.type) ?? 'http';
  const probe = type === 'tcp' ? 'TCP' : `${type.toUpperCase()} ${str(active.http_method) ?? 'GET'} ${str(active.http_path) ?? '/'}`;
  const text = t('up.sum.active', { probe });
  return isObj(checks.passive) ? `${text}; ${t('up.sum.passive')}` : text;
}

/** What is set among scheme, timeouts, retries, pass_host and the keepalive pool; else "Defaults". */
export function connectionSummary(up: Obj): string {
  const parts: string[] = [];
  const scheme = str(up.scheme);
  if (scheme) parts.push(scheme);
  if (isObj(up.timeout)) {
    const part = (key: string) => num((up.timeout as Obj)[key]) ?? '?';
    parts.push(t('up.sum.timeouts', { connect: part('connect'), send: part('send'), read: part('read') }));
  }
  const retries = num(up.retries);
  if (retries !== undefined) parts.push(retries === 1 ? t('up.sum.retriesOne') : t('up.sum.retriesMany', { count: retries }));
  const pass = str(up.pass_host);
  if (pass) parts.push(t('up.sum.passHost', { value: pass === 'rewrite' ? `${pass} ${str(up.upstream_host) ?? '?'}` : pass }));
  if (isObj(up.keepalive_pool)) parts.push(t('up.sum.pool'));
  return parts.length > 0 ? parts.join(', ') : t('up.sum.defaults');
}

/** The client certificate, verification and CA certificates; else "None". */
export function tlsSummary(up: Obj): string {
  const tls = obj(up.tls);
  const parts: string[] = [];
  const certId = typeof tls.client_cert_id === 'number' ? String(tls.client_cert_id) : str(tls.client_cert_id);
  if (certId) parts.push(t('up.sum.sslCert', { id: certId }));
  else if (str(tls.client_cert) || str(tls.client_key)) parts.push(t('up.sum.inlineCert'));
  if (tls.verify === true) parts.push(t('up.sum.verify'));
  if (tls.verify === false) parts.push(t('up.sum.noVerify'));
  const cas = Array.isArray(tls.ca_certs) ? tls.ca_certs.length : 0;
  if (cas > 0) parts.push(cas === 1 ? t('up.sum.caOne') : t('up.sum.caMany', { count: cas }));
  return parts.length > 0 ? parts.join(', ') : t('up.sum.tlsNone');
}

/** Each section's summary, by section id. */
export const SUMMARIES: Record<SectionId, (up: Obj) => string> = {
  nodes: nodesSummary,
  balancing: balancingSummary,
  health: healthSummary,
  connection: connectionSummary,
  tls: tlsSummary,
};
