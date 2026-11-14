// What APISIX 3.20 refuses in an upstream, checked in the browser so Save can say where: the
// `upstream` schema in apisix/schema_def.lua (nodes, timeout, tls dependencies, health checker
// ranges, warm_up_conf) and check_upstream_conf / check_warm_up_conf in apisix/upstream.lua (chash
// key, pass_host rewrite, map ports, ws + ca_certs). Pure; used by the Upstream editor's `validate`
// and, with a path prefix, by editors that hold an upstream inline.
import { isObj } from '../api/sanitize';
import type { Obj } from '../api/types';
import { getPath } from '../editor/draft';
import type { Issue } from '../editor/issues';
import { t } from '../i18n';
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

/** Numeric fields and their schema bounds, checked when set. */
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

/** Status lists: integers from 200 to 599. */
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

/** Nodes or discovery (APISIX's oneOf), then each node. */
function checkTarget(up: Obj, add: Add): void {
  const discovery = up.discovery_type !== undefined || up.service_name !== undefined;
  if (up.nodes === undefined) {
    if (!discovery) add('nodes', t('up.issue.noTarget'));
    if (discovery && !str(up.discovery_type)) add('discovery_type', t('up.issue.discoveryType'));
    if (discovery && !str(up.service_name)) add('service_name', t('up.issue.serviceName'));
    return;
  }
  if (str(up.discovery_type) && str(up.service_name)) add('nodes', t('up.issue.both'));
  const nodes = up.nodes;
  if (Array.isArray(nodes)) {
    if (nodes.length === 0) add('nodes', t('up.issue.noNodes'));
    nodes.forEach((node, i) => {
      const n = obj(node);
      if (!str(n.host)) add(`nodes.${i}.host`, t('up.issue.host'));
      if (n.port !== undefined && !(isWhole(n.port) && n.port >= 1 && n.port <= 65535)) add(`nodes.${i}.port`, t('up.issue.port'));
      if (n.weight === undefined) add(`nodes.${i}.weight`, t('up.issue.weightMissing'));
      else if (!(isWhole(n.weight) && n.weight >= 0)) add(`nodes.${i}.weight`, t('up.issue.weight'));
      if (n.priority !== undefined && !isWhole(n.priority)) add(`nodes.${i}.priority`, t('up.issue.priority'));
    });
  } else if (isObj(nodes)) {
    // A map entry's problems sit on its row, as the table shows it (in key order).
    const entries = Object.entries(nodes);
    if (entries.length === 0) add('nodes', t('up.issue.noNodes'));
    entries.forEach(([addr, weight], i) => {
      const { host, port } = parseAddr(addr);
      if (host === '') add(`nodes.${i}.host`, t('up.issue.host'));
      if (port !== undefined && (port < 1 || port > 65535)) add(`nodes.${i}.port`, t('up.issue.port'));
      if (weight === null || weight === undefined) add(`nodes.${i}.weight`, t('up.issue.weightMissing'));
      else if (!(isWhole(weight) && weight >= 0)) add(`nodes.${i}.weight`, t('up.issue.weight'));
    });
  } else add('nodes', t('up.issue.noNodes'));
}

function checkHashKey(up: Obj, add: Add): void {
  if (up.type !== 'chash') return;
  const on = str(up.hash_on) ?? 'vars';
  if (on === 'consumer') return;
  const key = str(up.key);
  if (key === undefined) add('key', t('up.issue.key'));
  else if (on === 'vars' && !HASH_VARS.test(key)) add('key', t('up.issue.keyVars'));
  else if ((on === 'header' || on === 'cookie') && !HASH_NAME.test(key)) add('key', t('up.issue.keyName'));
}

function checkTimeout(up: Obj, add: Add): void {
  if (up.timeout === undefined) return;
  const timeout = obj(up.timeout);
  for (const key of ['connect', 'send', 'read']) {
    const v = timeout[key];
    if (v === undefined) add(`timeout.${key}`, t('up.issue.timeoutAll'));
    else if (typeof v !== 'number' || !(v > 0)) add(`timeout.${key}`, t('up.issue.positive'));
  }
}

function checkTls(up: Obj, add: Add): void {
  const tls = obj(up.tls);
  const cert = tls.client_cert !== undefined;
  const key = tls.client_key !== undefined;
  if (cert && !key) add('tls.client_key', t('up.issue.needKey'));
  if (key && !cert) add('tls.client_cert', t('up.issue.needCert'));
  if (tls.client_cert_id !== undefined && cert && key) add('tls.client_cert_id', t('up.issue.certBoth'));
  if ((up.scheme === 'ws' || up.scheme === 'wss') && tls.ca_certs !== undefined) add('tls.ca_certs', t('up.issue.caWs'));
  if (Array.isArray(tls.ca_certs)) tls.ca_certs.forEach((pem, i) => !str(pem) && add(`tls.ca_certs.${i}`, t('up.issue.pem')));
}

function checkChecks(up: Obj, add: Add): void {
  if (up.checks === undefined) return;
  const checks = obj(up.checks);
  if (isObj(checks.active)) return;
  if (isObj(checks.passive)) add('checks.passive', t('up.issue.passiveNeedsActive'));
  else add('checks', t('up.issue.checksActive'));
}

function checkWarmUp(up: Obj, add: Add): void {
  if (up.warm_up_conf === undefined) return;
  const warm = obj(up.warm_up_conf);
  if (warm.slow_start_time_seconds === undefined) add('warm_up_conf.slow_start_time_seconds', t('up.issue.required'));
  if (warm.min_weight_percent === undefined) add('warm_up_conf.min_weight_percent', t('up.issue.required'));
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
export function upstreamIssues(up: Obj, pathPrefix?: string): Issue[] {
  const issues: Issue[] = [];
  const add: Add = (path, message) => issues.push({ path: pathPrefix ? (path === '' ? pathPrefix : `${pathPrefix}.${path}`) : path, message });

  checkTarget(up, add);
  checkHashKey(up, add);
  checkTimeout(up, add);
  if (up.pass_host === 'rewrite' && !str(up.upstream_host)) add('upstream_host', t('up.issue.upstreamHost'));
  checkTls(up, add);
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
  checkWarmUp(up, add);
  if (up.labels !== undefined && !(isObj(up.labels) && Object.values(up.labels).every((v) => typeof v === 'string' && /^\S+$/.test(v) && v.length <= 256))) {
    add('labels', t('up.issue.labels'));
  }
  return issues;
}
