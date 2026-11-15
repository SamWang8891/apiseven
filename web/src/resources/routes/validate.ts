// What APISIX 3.20 refuses in a route, checked in the browser so Save can say where: the `route`
// schema in apisix/schema_def.lua (uri/uris, host pattern, remote address formats, methods enum,
// timeout, filter_func, script, labels, uniqueItems, and its anyOf/not rules) and check_conf in
// apisix/admin/routes.lua (host with hosts, remote_addr with remote_addrs, references that must
// exist). Nothing stricter: `routeIssues` runs on the whole draft, so a check APISIX doesn't make
// would lock a stored route out of this editor. Advice that is stricter than APISIX (a URI must start
// with /, an IPv6 prefix of at most 128) applies where a value is typed: uriProblem and addrProblem,
// the Matching tab's tag boxes. Pure; the registry composes it into the route's `validate`, with the
// inline upstream's and the plugins' checks.
import { isObj } from '../../api/sanitize';
import { isLuaArray, isLuaObject } from '../../api/lua';
import type { Obj } from '../../api/types';
import type { Issue } from '../../editor/issues';
import { t } from '../../i18n';
import { pluginIssues } from '../../plugins/validate';
import { upstreamIssues } from '../../upstream/validate';
import type { ValidateEnv } from '../registry';
import { resolveRef, type CtxKind } from '../resolve';
import type { CtxList } from '../ctx';
import { IPV4, IPV4_CIDR, isIPv6 } from '../ip';
import { readPair } from './pairs';

/** The methods a route can match, in the schema's order (method_schema in schema_def.lua). */
export const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'CONNECT', 'TRACE', 'PURGE'] as const;

// host_def_pat in schema_def.lua: `*`, or an optional leading `*` and host characters.
const HOST = /^\*$|^\*?[0-9a-zA-Z\-._[\]:]+$/;
// ip_def's IPv6/CIDR pattern, as schema_def.lua writes it: a loose IPv6 form (the source says so)
// with any 1–3 digit prefix. Its IPv4 forms are ../ip's.
const IPV6_CIDR = /^([a-fA-F0-9]{0,4}:){1,8}(:[a-fA-F0-9]{0,4}){0,8}([a-fA-F0-9]{0,4})?\/[0-9]{1,3}$/;

/** remote_addr_def exactly: format ipv4 or ipv6 (inet_pton in APISIX), or one of ip_def's CIDR patterns. */
export function schemaAddress(text: string): boolean {
  return IPV4.test(text) || isIPv6(text) || IPV4_CIDR.test(text) || IPV6_CIDR.test(text);
}

/** A sound address as typed: IPv4 or IPv6, either with a CIDR prefix that fits it (0–32, 0–128). */
function soundAddress(text: string): boolean {
  if (IPV4.test(text) || IPV4_CIDR.test(text)) return true;
  const [ip = '', prefix, ...rest] = text.split('/');
  if (rest.length > 0 || !isIPv6(ip)) return false;
  return prefix === undefined || (/^(0|[1-9][0-9]{0,2})$/.test(prefix) && Number(prefix) <= 128);
}

/** Why APISIX refuses this host (host_def_pat), or undefined; the same as typed and as stored. */
export function hostProblem(host: string): string | undefined {
  return HOST.test(host) ? undefined : t('rt.issue.host', { host });
}

/**
 * Why a URI is refused as it is typed: it must start with / (APISIX takes any text, but request
 * paths start with /, so it would never match) and fit the schema's 4096 characters.
 */
export function uriProblem(uri: string): string | undefined {
  if (!uri.startsWith('/')) return t('rt.issue.uriSlash', { uri });
  return uri.length > 4096 ? t('rt.issue.uriLong') : undefined;
}

/** Why a client address is refused as it is typed: stricter than the schema's loose IPv6/CIDR pattern. */
export function addrProblem(addr: string): string | undefined {
  return soundAddress(addr) ? undefined : t('rt.issue.addr', { addr });
}

/** Whether APISIX refuses these labels: labels_def (schema_def.lua 108–115), each value a label_value_def (98–105): text without spaces, 1–256 characters. */
export function labelsRefused(labels: unknown): boolean {
  if (labels === undefined) return false;
  // An empty table is an object to APISIX (`labels: []` is stored): isLuaObject.
  return !(isLuaObject(labels) && Object.values(labels as object).every((v) => typeof v === 'string' && /^\S+$/.test(v) && v.length <= 256));
}

type Add = (path: string, message: string) => void;

type Problem = (v: string) => string | undefined;

/**
 * One of a single/plural pair: both set (check_conf / the schema's oneOf), then each value (at
 * `single`, or `plural.<i>`), and repeats in the plural list (uniqueItems).
 */
function checkPair(draft: Obj, single: string, plural: string, problems: { single: Problem; item: Problem }, add: Add): string[] {
  if (draft[single] !== undefined && draft[plural] !== undefined) add(plural, t('rt.issue.both', { single, plural }));
  const values = readPair(draft, single, plural);
  const one = typeof draft[single] === 'string' && draft[single] !== '';
  const seen = new Set<string>();
  values.forEach((value, i) => {
    const path = one ? single : `${plural}.${i}`;
    const message = (one ? problems.single : problems.item)(value) ?? (seen.has(value) ? t('rt.issue.twice', { value }) : undefined);
    seen.add(value);
    if (message) add(path, message);
  });
  return values;
}

const REFERENCES: [field: string, kind: CtxKind, list: CtxList, message: string][] = [
  ['service_id', 'services', 'services', 'rt.issue.missing.service'],
  ['upstream_id', 'upstreams', 'upstreams', 'rt.issue.missing.upstream'],
  ['plugin_config_id', 'plugin_configs', 'pluginConfigs', 'rt.issue.missing.pluginConfig'],
];

const has = (draft: Obj, key: string): boolean => draft[key] !== undefined;

/**
 * Problems in a route draft, each at its path, for the editor to show on the right tab: URIs, hosts
 * and addresses (Matching), what the route does (Upstream), references to objects that don't exist
 * (once their list has loaded), the inline upstream (`upstream.…`) and the plugins (`plugins.…`).
 */
export function routeIssues(draft: Obj, env: ValidateEnv): Issue[] {
  const issues: Issue[] = [];
  const add: Add = (path, message) => issues.push({ path, message });

  // uri: a string of 1–4096 characters; uris: strings, no length set, no repeats.
  const uriLength: Problem = (v) => (v.length > 4096 ? t('rt.issue.uriLong') : undefined);
  const uris = checkPair(draft, 'uri', 'uris', { single: uriLength, item: () => undefined }, add);
  if (uris.length === 0) add('uri', t('rt.issue.noUri'));
  checkPair(draft, 'host', 'hosts', { single: hostProblem, item: hostProblem }, add);
  const address: Problem = (v) => (schemaAddress(v) ? undefined : t('rt.issue.addr', { addr: v }));
  checkPair(draft, 'remote_addr', 'remote_addrs', { single: address, item: address }, add);

  if (draft.methods !== undefined) {
    // `methods: {}` is an empty table, so an empty list to APISIX (isLuaArray).
    const methods: unknown[] = Array.isArray(draft.methods) ? draft.methods : isLuaArray(draft.methods) ? [] : [draft.methods];
    const bad = methods.find((m) => !(METHODS as readonly unknown[]).includes(m));
    const twice = methods.find((m, i) => methods.indexOf(m) !== i);
    if (bad !== undefined) add('methods', t('rt.issue.method', { method: typeof bad === 'string' ? bad : JSON.stringify(bad) }));
    else if (twice !== undefined) add('methods', t('rt.issue.twice', { value: typeof twice === 'string' ? twice : JSON.stringify(twice) }));
  }
  if (draft.vars !== undefined && !isLuaArray(draft.vars)) add('vars', t('rt.issue.vars'));
  const filter = draft.filter_func;
  if (filter !== undefined && !(typeof filter === 'string' && filter.length >= 10 && filter.startsWith('function'))) add('filter_func', t('rt.issue.filterFunc'));

  if (draft.priority !== undefined && !Number.isInteger(draft.priority)) add('priority', t('rt.issue.priority'));
  if (labelsRefused(draft.labels)) add('labels', t('rt.issue.labels'));
  if (draft.timeout !== undefined) {
    const timeout = isObj(draft.timeout) ? draft.timeout : {};
    for (const key of ['connect', 'send', 'read']) {
      const v = timeout[key];
      if (v === undefined) add(`timeout.${key}`, t('rt.issue.timeoutAll'));
      else if (typeof v !== 'number' || !(v > 0)) add(`timeout.${key}`, t('rt.issue.positive'));
    }
  }

  // The schema's anyOf: a route needs plugins, an upstream (by any of its three sources) or a
  // script. A plugin config alone is refused.
  if (!['plugins', 'upstream', 'upstream_id', 'service_id', 'script'].some((key) => has(draft, key))) {
    issues.push({ path: '', message: t('rt.issue.nothing'), tab: 'upstream', missing: true });
  }
  const script = draft.script;
  if (script !== undefined) {
    if (has(draft, 'plugins') || has(draft, 'plugin_config_id')) add('script', t('rt.issue.scriptWithPlugins'));
    else if (!(typeof script === 'string' && script.length >= 10 && script.length <= 102400)) add('script', t('rt.issue.scriptLength'));
  }

  for (const [field, kind, list, message] of REFERENCES) {
    const ref = resolveRef(kind, draft[field], env.ctx);
    if (ref && !ref.item && env.ctx.loaded[list]) add(field, t(message, { id: ref.id }));
  }

  // APISIX checks an inline upstream whenever it is there, also beside an upstream_id (which wins).
  if (isObj(draft.upstream)) issues.push(...upstreamIssues(draft.upstream, 'upstream'));
  issues.push(...pluginIssues(draft, env, 'route'));
  return issues;
}
