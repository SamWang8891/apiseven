// What APISIX 3.20 refuses in an upstream, checked in the browser so Save can say where, and nothing
// stricter (addendum rule 10: these issues block Save on the whole draft, the JSON tab's too). Two
// sources, each check citing its line (apisix/schema_def.lua, apisix/upstream.lua):
// - the `upstream` schema (schema_def.lua 459–602): nodes, timeout, tls dependencies, health checker
//   ranges, warm_up_conf, labels — what every kind refuses;
// - check_upstream_conf (upstream.lua 622–740, with check_schema 534–541 and check_warm_up_conf
//   575–618): the chash key, map ports, an unbracketed IPv6 node host, pass_host rewrite, ws + CA,
//   slow start's fit — what admin/upstreams.lua 32, admin/routes.lua 70–76 and admin/services.lua
//   40–46 run, and admin/stream_routes.lua doesn't (`{ checkConf: false }`: the schema only).
// An empty node list is not among them (APISIX stores it; requests fail until a node is added): the
// nodes section says so, without blocking. Pure; used by the Upstream editor's `validate` and, with a
// path prefix, by editors that hold an upstream inline.
import { isLuaObject } from '../api/lua';
import { isObj } from '../api/sanitize';
import type { Obj } from '../api/types';
import { getPath } from '../editor/draft';
import type { Issue } from '../editor/issues';
import { t } from '../i18n';
import { isIPv6 } from '../resources/ip';
import { parseAddr } from './nodes';

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const obj = (v: unknown): Obj => (isObj(v) ? v : {});
const isWhole = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

// upstream_hash_vars_schema and upstream_hash_header_schema in schema_def.lua, as written there.
const HASH_VARS = /^((uri|server_name|server_addr|request_uri|remote_port|remote_addr|query_string|host|hostname|mqtt_client_id)|arg_[0-9a-zA-z_-]+)$/;
const HASH_NAME = /^[a-zA-Z0-9-_]+$/;

interface NumberRule {
  whole?: boolean;
  min?: number;
  max?: number;
}

/** Numeric fields and their schema bounds, checked when set (schema_def.lua 149–311, 417–455, 473–527). */
const NUMBERS: [path: string, rule: NumberRule][] = [
  ['retries', { whole: true, min: 0 }],
  ['retry_timeout', { min: 0 }],
  ['keepalive_pool.size', { whole: true, min: 1 }],
  ['keepalive_pool.idle_timeout', { min: 0 }],
  ['keepalive_pool.requests', { whole: true, min: 1 }],
  ['checks.active.timeout', {}],
  ['checks.active.concurrency', { whole: true }],
  ['checks.active.port', { whole: true, min: 1, max: 65535 }],
  ['checks.active.healthy.interval', { whole: true, min: 1 }],
  ['checks.active.healthy.successes', { whole: true, min: 1, max: 254 }],
  ['checks.active.unhealthy.interval', { whole: true, min: 1 }],
  ['checks.active.unhealthy.http_failures', { whole: true, min: 1, max: 254 }],
  ['checks.active.unhealthy.tcp_failures', { whole: true, min: 1, max: 254 }],
  ['checks.active.unhealthy.timeouts', { whole: true, min: 1, max: 254 }],
  ['checks.passive.healthy.successes', { whole: true, min: 0, max: 254 }],
  ['checks.passive.unhealthy.http_failures', { whole: true, min: 0, max: 254 }],
  ['checks.passive.unhealthy.tcp_failures', { whole: true, min: 0, max: 254 }],
  ['checks.passive.unhealthy.timeouts', { whole: true, min: 0, max: 254 }],
  ['warm_up_conf.slow_start_time_seconds', { whole: true, min: 1 }],
  ['warm_up_conf.min_weight_percent', { whole: true, min: 1, max: 100 }],
  ['warm_up_conf.interval', { whole: true, min: 1 }],
  ['warm_up_conf.aggression', { min: 0.01 }],
  ['warm_up_conf.startup_grace_period_seconds', { whole: true, min: 0 }],
];

/** Status lists: at least one integer from 200 to 599 (schema_def.lua 177–187, 200–210, 255–267, 279–289). */
const STATUS_LISTS = ['checks.active.healthy.http_statuses', 'checks.active.unhealthy.http_statuses', 'checks.passive.healthy.http_statuses', 'checks.passive.unhealthy.http_statuses'];

function numberIssue(value: unknown, { whole, min, max }: NumberRule): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return t('up.issue.number');
  const fits = (!whole || Number.isInteger(value)) && (min === undefined || value >= min) && (max === undefined || value <= max);
  if (fits) return undefined;
  if (whole && min !== undefined && max !== undefined) return t('up.issue.range', { min, max });
  if (whole && min !== undefined) return t('up.issue.minWhole', { min });
  if (whole) return t('up.issue.whole');
  return t('up.issue.min', { min: min ?? 0 });
}

type Add = (path: string, message: string) => void;

export interface UpstreamCheckOptions {
  /**
   * Also what check_upstream_conf refuses beyond the schema (apisix/upstream.lua: the chash key,
   * map ports, an unbracketed IPv6 node host, pass_host rewrite, ws + ca_certs, slow start's fit).
   * Default true; false for an upstream APISIX checks by the schema only (a stream route's).
   */
  checkConf?: boolean;
}

/** Nodes or discovery, then each node. `conf`: check_upstream_conf's checks too. */
function checkTarget(up: Obj, add: Add, conf: boolean): void {
  const hasType = up.discovery_type !== undefined;
  const hasName = up.service_name !== undefined;
  // The schema's oneOf (schema_def.lua 597–600): `nodes`, or both `service_name` and `discovery_type`.
  if (up.nodes === undefined) {
    if (!hasType && !hasName) add('nodes', t('up.issue.noTarget'));
    if ((hasType || hasName) && !hasType) add('discovery_type', t('up.issue.discoveryType'));
    // service_name: 1–256 characters (591–595); an empty discovery_type is still a string (558–561).
    if ((hasType || hasName) && !str(up.service_name)) add('service_name', t('up.issue.serviceName'));
    return;
  }
  // nodes with both discovery keys matches both branches of the oneOf.
  if (hasType && hasName) add('nodes', t('up.issue.both'));
  const nodes = up.nodes;
  if (Array.isArray(nodes)) {
    // nodes_schema's array (341–369): objects with host (host_def) and weight, port 1–65535, whole numbers.
    nodes.forEach((node, i) => {
      const n = obj(node);
      const host = str(n.host);
      if (host === undefined) add(`nodes.${i}.host`, t('up.issue.host'));
      // check_schema (upstream.lua 535–539): an IPv6 host goes in brackets.
      else if (conf && !host.startsWith('[') && isIPv6(host)) add(`nodes.${i}.host`, t('up.issue.ipv6Brackets', { host }));
      if (n.port !== undefined && !(isWhole(n.port) && n.port >= 1 && n.port <= 65535)) add(`nodes.${i}.port`, t('up.issue.port'));
      if (n.weight === undefined) add(`nodes.${i}.weight`, t('up.issue.weightMissing'));
      else if (!(isWhole(n.weight) && n.weight >= 0)) add(`nodes.${i}.weight`, t('up.issue.weight'));
      if (n.priority !== undefined && !isWhole(n.priority)) add(`nodes.${i}.priority`, t('up.issue.priority'));
    });
  } else if (isObj(nodes)) {
    // A map entry's problems sit on its row, as the table shows it (in key order). The schema takes
    // any key (patternProperties ".*", 332–339) and a weight that is a whole number ≥ 0.
    Object.entries(nodes).forEach(([addr, weight], i) => {
      // check_upstream_conf (upstream.lua 634–644): a port in the key is 1–65535.
      const { port } = parseAddr(addr);
      if (conf && port !== undefined && (port < 1 || port > 65535)) add(`nodes.${i}.port`, t('up.issue.port'));
      if (weight === null || weight === undefined) add(`nodes.${i}.weight`, t('up.issue.weightMissing'));
      else if (!(isWhole(weight) && weight >= 0)) add(`nodes.${i}.weight`, t('up.issue.weight'));
    });
  } else add('nodes', t('up.issue.nodesType'));
}

/** check_upstream_conf (upstream.lua 719–738): chash needs a key (unless on the consumer) that fits what it hashes on. */
function checkHashKey(up: Obj, add: Add): void {
  if (up.type !== 'chash') return;
  // hash_on defaults to vars (schema_def.lua 534–544; the schema check fills defaults first).
  const on = str(up.hash_on) ?? 'vars';
  if (on === 'consumer') return;
  // "missing key" (723–725) is about presence: an empty key goes on to the patterns.
  if (up.key === undefined) {
    add('key', t('up.issue.key'));
    return;
  }
  // A key that isn't text is refused by the schema (545–548); its JSON then fails the patterns too.
  const key = typeof up.key === 'string' ? up.key : JSON.stringify(up.key);
  // upstream_hash_vars_schema / upstream_hash_header_schema (schema_def.lua 605–619);
  // vars_combinations takes any text (622–624).
  if (on === 'vars' && !HASH_VARS.test(key)) add('key', t('up.issue.keyVars'));
  else if ((on === 'header' || on === 'cookie') && !HASH_NAME.test(key)) add('key', t('up.issue.keyName'));
}

/** timeout_def (schema_def.lua 130–139): all three, each above 0. */
function checkTimeout(up: Obj, add: Add): void {
  if (up.timeout === undefined) return;
  const timeout = obj(up.timeout);
  for (const key of ['connect', 'send', 'read']) {
    const v = timeout[key];
    if (v === undefined) add(`timeout.${key}`, t('up.issue.timeoutAll'));
    else if (typeof v !== 'number' || !(v > 0)) add(`timeout.${key}`, t('up.issue.positive'));
  }
}

/** tls (schema_def.lua 482–507): a cert with its key and not beside client_cert_id; CA entries; ws + CA (upstream.lua 694–698). */
function checkTls(up: Obj, add: Add, conf: boolean): void {
  const tls = obj(up.tls);
  const cert = tls.client_cert !== undefined;
  const key = tls.client_key !== undefined;
  if (cert && !key) add('tls.client_key', t('up.issue.needKey'));
  if (key && !cert) add('tls.client_cert', t('up.issue.needCert'));
  if (tls.client_cert_id !== undefined && cert && key) add('tls.client_cert_id', t('up.issue.certBoth'));
  if (conf && (up.scheme === 'ws' || up.scheme === 'wss') && tls.ca_certs !== undefined) add('tls.ca_certs', t('up.issue.caWs'));
  if (Array.isArray(tls.ca_certs)) tls.ca_certs.forEach((pem, i) => !str(pem) && add(`tls.ca_certs.${i}`, t('up.issue.pem')));
}

/** health_checker (schema_def.lua 315–325): active checks, with or without passive ones. */
function checkChecks(up: Obj, add: Add): void {
  if (up.checks === undefined) return;
  const checks = obj(up.checks);
  // An empty table is an object to APISIX (`active: []` is stored): isLuaObject.
  if (checks.active !== undefined && isLuaObject(checks.active)) return;
  if (checks.passive !== undefined && isLuaObject(checks.passive)) add('checks.passive', t('up.issue.passiveNeedsActive'));
  else add('checks', t('up.issue.checksActive'));
}

/** warm_up_conf: its required fields (schema_def.lua 453); with `conf`, check_warm_up_conf (upstream.lua 585–618). */
function checkWarmUp(up: Obj, add: Add, conf: boolean): void {
  if (up.warm_up_conf === undefined) return;
  const warm = obj(up.warm_up_conf);
  if (warm.slow_start_time_seconds === undefined) add('warm_up_conf.slow_start_time_seconds', t('up.issue.required'));
  if (warm.min_weight_percent === undefined) add('warm_up_conf.min_weight_percent', t('up.issue.required'));
  if (!conf) return;
  if ((str(up.type) ?? 'roundrobin') !== 'roundrobin') add('warm_up_conf', t('up.issue.warmType'));
  const interval = typeof warm.interval === 'number' ? warm.interval : 1;
  if (typeof warm.slow_start_time_seconds === 'number' && interval > warm.slow_start_time_seconds) add('warm_up_conf.interval', t('up.issue.warmInterval'));
  if (Array.isArray(up.nodes)) {
    const tiers = new Set(up.nodes.map((node) => obj(node).priority ?? 0));
    if (tiers.size > 1) add('warm_up_conf', t('up.issue.warmPriority'));
  }
}

/**
 * Problems in an upstream, each at its path (`nodes.0.host`, `timeout.read`, `key`). With a
 * `pathPrefix` (e.g. 'upstream' for a route's inline upstream) every path starts with it.
 */
export function upstreamIssues(up: Obj, pathPrefix?: string, { checkConf = true }: UpstreamCheckOptions = {}): Issue[] {
  const issues: Issue[] = [];
  const add: Add = (path, message) => issues.push({ path: pathPrefix ? (path === '' ? pathPrefix : `${pathPrefix}.${path}`) : path, message });

  checkTarget(up, add, checkConf);
  if (checkConf) checkHashKey(up, add);
  checkTimeout(up, add);
  // check_upstream_conf (upstream.lua 685–690), http only, which the Admin API always is.
  if (checkConf && up.pass_host === 'rewrite' && !str(up.upstream_host)) add('upstream_host', t('up.issue.upstreamHost'));
  checkTls(up, add, checkConf);
  checkChecks(up, add);
  for (const [path, rule] of NUMBERS) {
    const value = getPath(up, path.split('.'));
    const message = value === undefined ? undefined : numberIssue(value, rule);
    if (message) add(path, message);
  }
  for (const path of STATUS_LISTS) {
    const list = getPath(up, path.split('.'));
    if (list !== undefined && !(Array.isArray(list) && list.length > 0 && list.every((s) => isWhole(s) && s >= 200 && s <= 599))) add(path, t('up.issue.statuses'));
  }
  checkWarmUp(up, add, checkConf);
  // labels_def (schema_def.lua 108–115, 466); an empty table is an object to APISIX.
  if (up.labels !== undefined && !(isLuaObject(up.labels) && Object.values(up.labels as object).every((v) => typeof v === 'string' && /^\S+$/.test(v) && v.length <= 256))) {
    add('labels', t('up.issue.labels'));
  }
  return issues;
}
