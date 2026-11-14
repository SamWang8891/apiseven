// What APISIX 3.20 refuses in a route, checked in the browser so Save can say where: the `route`
// schema in apisix/schema_def.lua (uri/uris, host pattern, remote address formats, methods enum,
// timeout, filter_func, script, labels, and its anyOf/not rules) and check_conf in
// apisix/admin/routes.lua (host with hosts, remote_addr with remote_addrs, references that must
// exist). Plus one APISIX accepts but that can never match: a URI not starting with `/`. Pure; the
// registry composes it into the route's `validate`, with the inline upstream's and the plugins' checks.
import { isObj } from '../../api/sanitize';
import type { Obj } from '../../api/types';
import type { Issue } from '../../editor/issues';
import { t } from '../../i18n';
import { pluginIssues } from '../../plugins/validate';
import { upstreamIssues } from '../../upstream/validate';
import type { ValidateEnv } from '../registry';
import { resolveRef, type CtxKind } from '../resolve';
import type { CtxList } from '../ctx';
import { readPair } from './pairs';

/** The methods a route can match, in the schema's order (method_schema in schema_def.lua). */
export const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'CONNECT', 'TRACE', 'PURGE'] as const;

// host_def_pat in schema_def.lua: `*`, or an optional leading `*` and host characters.
const HOST = /^\*$|^\*?[0-9a-zA-Z\-._[\]:]+$/;
const OCTET = '(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])';
const IPV4 = new RegExp(`^${OCTET}(\\.${OCTET}){3}$`);
const GROUP = /^[0-9a-fA-F]{1,4}$/;

function isIPv6(text: string): boolean {
  let s = text;
  // A trailing IPv4 (::ffff:10.0.0.1) stands for the last two groups.
  if (s.includes('.')) {
    const at = s.lastIndexOf(':');
    if (at < 0 || !IPV4.test(s.slice(at + 1))) return false;
    s = `${s.slice(0, at + 1)}0:0`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return false;
  const groups = (part: string | undefined) => (part === undefined || part === '' ? [] : part.split(':'));
  const all = [...groups(halves[0]), ...groups(halves[1])];
  if (!all.every((g) => GROUP.test(g))) return false;
  return halves.length === 2 ? all.length <= 7 : all.length === 8;
}

/** ip_def in schema_def.lua: IPv4, IPv4/CIDR (0–32), IPv6, IPv6/CIDR (0–128). */
function isAddress(text: string): boolean {
  const [ip = '', prefix, ...rest] = text.split('/');
  if (rest.length > 0) return false;
  const v4 = IPV4.test(ip);
  if (!v4 && !isIPv6(ip)) return false;
  if (prefix === undefined) return true;
  return /^[0-9]{1,3}$/.test(prefix) && Number(prefix) <= (v4 ? 32 : 128);
}

/** Why APISIX refuses this host, or undefined. */
export function hostProblem(host: string): string | undefined {
  return HOST.test(host) ? undefined : t('rt.issue.host', { host });
}

/** Why this URI can't match, or undefined (APISIX takes any non-empty text, but request paths start with /). */
export function uriProblem(uri: string): string | undefined {
  if (!uri.startsWith('/')) return t('rt.issue.uriSlash', { uri });
  return uri.length > 4096 ? t('rt.issue.uriLong') : undefined;
}

/** Why APISIX refuses this client address, or undefined. */
export function addrProblem(addr: string): string | undefined {
  return isAddress(addr) ? undefined : t('rt.issue.addr', { addr });
}

type Add = (path: string, message: string) => void;

/** One of a single/plural pair: both set, then each value (at `single`, or `plural.<i>`), and repeats. */
function checkPair(draft: Obj, single: string, plural: string, problem: (v: string) => string | undefined, add: Add): string[] {
  if (draft[single] !== undefined && draft[plural] !== undefined) add(plural, t('rt.issue.both', { single, plural }));
  const values = readPair(draft, single, plural);
  const one = typeof draft[single] === 'string' && draft[single] !== '';
  const seen = new Set<string>();
  values.forEach((value, i) => {
    const path = one ? single : `${plural}.${i}`;
    const message = problem(value) ?? (seen.has(value) ? t('rt.issue.twice', { value }) : undefined);
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

  const uris = checkPair(draft, 'uri', 'uris', uriProblem, add);
  if (uris.length === 0) add('uri', t('rt.issue.noUri'));
  checkPair(draft, 'host', 'hosts', hostProblem, add);
  checkPair(draft, 'remote_addr', 'remote_addrs', addrProblem, add);

  if (draft.methods !== undefined) {
    const methods: unknown[] = Array.isArray(draft.methods) ? draft.methods : [draft.methods];
    const bad = methods.find((m) => !(METHODS as readonly unknown[]).includes(m));
    if (bad !== undefined) add('methods', t('rt.issue.method', { method: typeof bad === 'string' ? bad : JSON.stringify(bad) }));
  }
  if (draft.vars !== undefined && !Array.isArray(draft.vars)) add('vars', t('rt.issue.vars'));
  const filter = draft.filter_func;
  if (filter !== undefined && !(typeof filter === 'string' && filter.length >= 10 && filter.startsWith('function'))) add('filter_func', t('rt.issue.filterFunc'));

  if (draft.priority !== undefined && !Number.isInteger(draft.priority)) add('priority', t('rt.issue.priority'));
  if (draft.labels !== undefined && !(isObj(draft.labels) && Object.values(draft.labels).every((v) => typeof v === 'string' && /^\S+$/.test(v) && v.length <= 256))) {
    add('labels', t('rt.issue.labels'));
  }
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
    issues.push({ path: '', message: t('rt.issue.nothing'), tab: 'upstream' });
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
