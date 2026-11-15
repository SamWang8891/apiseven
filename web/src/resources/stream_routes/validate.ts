// What APISIX 3.20 refuses in a stream route, checked in the browser so Save can say where: the
// `stream_route` schema in apisix/schema_def.lua (1076–1134; the protocol's 1037–1073), check_conf in
// apisix/admin/stream_routes.lua (references that must exist, the protocol's superior) and the
// stream_route_checker it calls (apisix/stream/router/ip_port.lua 234–264: the plugins against the
// stream set, the addresses through core.ip.validate_cidr_or_ip). Nothing stricter: a stream route
// needs no field at all, an upstream included, and its inline upstream is checked by the schema only
// (check_conf never calls check_upstream_conf). Pure; the registry uses it as the kind's `validate`.
import { isObj } from '../../api/sanitize';
import { isLuaArray, isLuaObject } from '../../api/lua';
import type { Obj } from '../../api/types';
import type { Issue } from '../../editor/issues';
import { t } from '../../i18n';
import { pluginIssues } from '../../plugins/validate';
import { upstreamIssues } from '../../upstream/validate';
import type { ValidateEnv } from '../registry';
import { resolveRef } from '../resolve';
import { isIPv6 } from '../ip';
import { hostProblem, labelsRefused, schemaAddress } from '../routes/validate';

type Add = (path: string, message: string) => void;

const idOf = (v: unknown): string | undefined => (typeof v === 'number' ? String(v) : typeof v === 'string' && v !== '' ? v : undefined);

/**
 * Why APISIX refuses a stream route's server_addr or remote_addr, or undefined: the schema's ip_def
 * (schema_def.lua 75–81), then validate_cidr_or_ip (apisix/core/ip.lua 54–77), which also wants the
 * address of a CIDR to parse and its prefix to fit it (0–32, 0–128) — so `fe80::/200`, which the
 * schema's loose IPv6/CIDR pattern lets through, is refused here.
 */
export function streamAddressProblem(addr: string): string | undefined {
  const refused = t('rt.issue.addr', { addr });
  if (!schemaAddress(addr)) return refused;
  const [ip = '', prefix] = addr.split('/');
  // A plain address passed the schema's ipv4 / ipv6 formats; an IPv4 CIDR its 0–32 pattern.
  if (prefix === undefined || !ip.includes(':')) return undefined;
  return isIPv6(ip) && Number(prefix) <= 128 ? undefined : refused;
}

/** sni (1100–1104) and snis (1105–1114: host patterns, at least one, no repeats), not both (1130–1132). */
function checkSnis(draft: Obj, add: Add): void {
  if (draft.sni !== undefined && draft.snis !== undefined) add('snis', t('rt.issue.both', { single: 'sni', plural: 'snis' }));
  if (draft.sni !== undefined) {
    const problem = typeof draft.sni === 'string' ? hostProblem(draft.sni) : t('rt.issue.host', { host: JSON.stringify(draft.sni) });
    if (problem) add('sni', problem);
  }
  const snis = draft.snis;
  if (snis === undefined) return;
  if (!Array.isArray(snis) || snis.length === 0) {
    add('snis', t('sr.issue.snisEmpty'));
    return;
  }
  const seen = new Set<unknown>();
  snis.forEach((sni: unknown, i) => {
    const problem = typeof sni === 'string' ? hostProblem(sni) : t('rt.issue.host', { host: JSON.stringify(sni) });
    const message = problem ?? (seen.has(sni) ? t('rt.issue.twice', { value: String(sni) }) : undefined);
    seen.add(sni);
    if (message) add(`snis.${i}`, message);
  });
}

/**
 * A logger entry as xrpc_protocol_schema's items take it (schema_def.lua 1047–1065): only name,
 * filter and conf, of their types, and conf beside a name. The items have no `type`, so an entry
 * that isn't an object passes.
 */
function loggerEntryOk(entry: unknown): boolean {
  if (!isObj(entry)) return true;
  if (Object.keys(entry).some((key) => key !== 'name' && key !== 'filter' && key !== 'conf')) return false;
  if (entry.name !== undefined && typeof entry.name !== 'string') return false;
  if (entry.filter !== undefined && !isLuaArray(entry.filter)) return false;
  if (entry.conf !== undefined && !isLuaObject(entry.conf)) return false;
  return entry.name === undefined || entry.conf !== undefined;
}

/** The protocol (xRPC): the schema (1037–1073) and the superior checks of admin/stream_routes.lua (65–107). */
function checkProtocol(draft: Obj, env: ValidateEnv, add: Add): void {
  const protocol = draft.protocol;
  if (protocol === undefined) return;
  // An empty table passes either type (isLuaObject / isLuaArray): `conf: []`, `logger: {}`.
  if (!isLuaObject(protocol)) {
    add('protocol', t('sr.issue.protocol'));
    return;
  }
  const p = isObj(protocol) ? protocol : {};
  if (typeof p.name !== 'string') add('protocol.name', t('sr.issue.protocolName'));
  if (p.conf !== undefined && !isLuaObject(p.conf)) add('protocol.conf', t('sr.issue.protocolConf'));
  if (p.logger !== undefined) {
    if (!isLuaArray(p.logger)) add('protocol.logger', t('sr.issue.logger'));
    else if (Array.isArray(p.logger)) p.logger.forEach((entry, i) => !loggerEntryOk(entry) && add('protocol.logger', t('sr.issue.loggerEntry', { n: i + 1 })));
  }

  const superior = idOf(p.superior_id);
  if (superior === undefined) return;
  // admin/stream_routes.lua 67–72: never itself.
  if (superior === idOf(draft.id)) {
    add('protocol.superior_id', t('sr.issue.superiorSelf'));
    return;
  }
  // 74–89: it must exist (known only once the list has loaded); 101–106: of the same protocol.
  const found = resolveRef('stream_routes', superior, env.ctx);
  if (!found?.item) {
    if (env.ctx.loaded.streamRoutes) add('protocol.superior_id', t('sr.issue.superiorMissing', { id: superior }));
    return;
  }
  const theirs = found.item.value.protocol;
  if (isObj(theirs) && theirs.name !== p.name && typeof p.name === 'string') {
    add('protocol.name', t('sr.issue.superiorProtocol', { name: p.name, superior: String(theirs.name) }));
  }
}

/**
 * Problems in a stream route draft, each at its path, for the editor to show on the right tab:
 * what it matches (Matching), the upstream and references (Upstream), the protocol (Advanced), the
 * inline upstream (`upstream.…`) and the plugins (`plugins.…`, the stream set).
 */
export function streamRouteIssues(draft: Obj, env: ValidateEnv): Issue[] {
  const issues: Issue[] = [];
  const add: Add = (path, message) => issues.push({ path, message });

  // server_port (1094–1099): a whole number from 1 to 65535.
  const port = draft.server_port;
  if (port !== undefined && !(typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535)) add('server_port', t('sr.issue.port'));
  // server_addr (1089–1093) and remote_addr (1088): ip_def, then validate_cidr_or_ip (ip_port.lua 242–251).
  for (const field of ['server_addr', 'remote_addr']) {
    const value = draft[field];
    if (value === undefined) continue;
    const problem = typeof value === 'string' ? streamAddressProblem(value) : t('rt.issue.addr', { addr: JSON.stringify(value) });
    if (problem) add(field, problem);
  }
  checkSnis(draft, add);
  if (labelsRefused(draft.labels)) add('labels', t('rt.issue.labels'));

  // admin/stream_routes.lua 31–63: the service and the upstream must exist (known once loaded).
  const service = resolveRef('services', draft.service_id, env.ctx);
  if (service && !service.item && env.ctx.loaded.services) add('service_id', t('rt.issue.missing.service', { id: service.id }));
  const upstream = resolveRef('upstreams', draft.upstream_id, env.ctx);
  if (upstream && !upstream.item && env.ctx.loaded.upstreams) add('upstream_id', t('rt.issue.missing.upstream', { id: upstream.id }));
  checkProtocol(draft, env, add);

  // The schema's upstream_schema (1122) only.
  if (isObj(draft.upstream)) issues.push(...upstreamIssues(draft.upstream, 'upstream', { checkConf: false }));
  // ip_port.lua 235–240: stream_plugin_checker, against the stream set.
  issues.push(...pluginIssues(draft, env, 'stream_route'));
  return issues;
}
