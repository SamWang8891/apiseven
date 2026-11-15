// Problems with a draft, found in the browser (ResourceDef.validate, the frame's own checks) or named
// by APISIX's answer to a save. Each one is attributed to a tab, which shows its count as a badge.
import type { Obj } from '../api/types';
import { t } from '../i18n';

export interface Issue {
  /** Dotted path into the draft, e.g. 'uri', 'plugins.limit-count.count'; '' for the object as a whole. */
  path: string;
  message: string;
  /** The tab id, when the producer knows it (otherwise the tab owning the path's first segment). */
  tab?: string;
}

/** The message of the issue at exactly `path`. */
export function issueAt(issues: Issue[], path: string): string | undefined {
  return issues.find((issue) => issue.path === path)?.message;
}

const isUnder = (path: string, prefix: string): boolean => prefix === '' || path === prefix || path.startsWith(`${prefix}.`);

/** The issues at `prefix` or below it (`plugins.cors` takes `plugins.cors.x`, not `plugins.cors2`). Paths stay as they are. */
export function issuesUnder(issues: Issue[], prefix: string): Issue[] {
  return issues.filter((issue) => isUnder(issue.path, prefix));
}

/** issuesUnder, with each path made relative to `prefix` (for a form editing just that sub-object). */
export function withinPath(issues: Issue[], prefix: string): Issue[] {
  return issuesUnder(issues, prefix).map((issue) => ({
    ...issue,
    path: prefix === '' ? issue.path : issue.path.slice(prefix.length + 1),
  }));
}

/** What tabOfIssue needs to know of a tab. */
export interface TabFields {
  id: string;
  fields: string[];
  /** Also every top-level key no tab names, but `id` (TabDef.restFields). */
  rest?: boolean;
}

/**
 * `issue.tab` when such a tab exists, else the tab whose fields hold the path's first segment, else
 * the tab that owns the rest (a key no tab names, but `id`), else `fallback`.
 */
export function tabOfIssue(issue: Issue, tabs: TabFields[], fallback: string): string {
  if (issue.tab !== undefined && tabs.some((tab) => tab.id === issue.tab)) return issue.tab;
  const top = issue.path.split('.')[0] ?? '';
  if (top === '') return fallback;
  return tabs.find((tab) => tab.fields.includes(top))?.id ?? (top !== 'id' ? tabs.find((tab) => tab.rest)?.id : undefined) ?? fallback;
}

/** The top-level keys of `draft` and `baseline` a tab owns: its fields, or with `rest` also every key no tab names (but `id`). */
export function ownedKeys(tab: TabFields, tabs: TabFields[], draft: Obj, baseline: Obj): string[] {
  if (!tab.rest) return tab.fields;
  const named = new Set(['id', ...tabs.flatMap((other) => other.fields)]);
  return [...new Set([...tab.fields, ...Object.keys(draft), ...Object.keys(baseline)])].filter((key) => tab.fields.includes(key) || !named.has(key));
}

/** The issues grouped by the tab they belong to (tabs without any are absent). */
export function issuesByTab(issues: Issue[], tabs: TabFields[], fallback: string): Map<string, Issue[]> {
  const by = new Map<string, Issue[]>();
  for (const issue of issues) {
    const id = tabOfIssue(issue, tabs, fallback);
    by.set(id, [...(by.get(id) ?? []), issue]);
  }
  return by;
}

/**
 * What APISIX 3.20 says when it refuses a save, and the draft path each message is about. Only
 * shapes whose field is certain are listed (from admin/*.lua, plugin.lua, ssl.lua); anything else
 * names no field and shows in the banner only. The first match wins.
 */
const ERROR_PATHS: { pattern: RegExp; path: (m: RegExpExecArray) => string }[] = [
  // The kind's own schema (every kind, also an SSL and a standalone upstream). The first property
  // is the top-level key; a nested one follows it ("property "upstream" … property "nodes"").
  { pattern: /^invalid configuration: property "([^"]+)"/, path: (m) => m[1] ?? '' },
  // A proto APISIX cannot compile (admin/proto.lua 33–36).
  { pattern: /^invalid content: /, path: () => 'content' },
  // A plugin a global rule shares with another one (admin/global_rules.lua 72–76).
  { pattern: /^plugin '([^']+)' already exists in global rule with id '/, path: (m) => `plugins.${m[1] ?? ''}` },
  // A plugin's schema; consumers and credentials wrap it in "invalid plugins configuration: ".
  { pattern: /^(?:invalid plugins configuration: )?failed to check the configuration of plugin (\S+) err: /, path: (m) => `plugins.${m[1] ?? ''}` },
  { pattern: /^failed to check the configuration of stream plugin \[([^\]]+)\]: /, path: (m) => `plugins.${m[1] ?? ''}` },
  { pattern: /^(?:invalid plugins configuration: )?unknown plugin \[([^\]]+)\]$/, path: (m) => `plugins.${m[1] ?? ''}` },
  { pattern: /^unknown plugin (\S+)$/, path: (m) => `plugins.${m[1] ?? ''}` },
  // References to other objects that APISIX could not find.
  { pattern: /^failed to fetch upstream info by upstream id \[/, path: () => 'upstream_id' },
  { pattern: /^failed to fetch service info by service id \[/, path: () => 'service_id' },
  { pattern: /^failed to fetch plugin config info by plugin config id \[/, path: () => 'plugin_config_id' },
  { pattern: /^failed to fetch consumer group info by consumer group id \[/, path: () => 'group_id' },
  // Route fields APISIX compiles.
  { pattern: /^failed to validate the 'vars' expression: /, path: () => 'vars' },
  { pattern: /^(?:failed to load 'filter_func' string: |'filter_func' should be a function$)/, path: () => 'filter_func' },
  { pattern: /^(?:failed to load 'script' string: |'script' should be a Lua object$)/, path: () => 'script' },
  // An SSL (apisix/ssl.lua): its main pair (111, 123, 128), the number of extra pairs (208), an extra
  // pair by its 1-based place (217: the key when the rest is about one), the client CA (230).
  { pattern: /^failed to parse cert: /, path: () => 'cert' },
  { pattern: /^(?:failed to parse key: |failed to decrypt previous encrypted key$)/, path: () => 'key' },
  { pattern: /^mismatched number of certs and keys$/, path: () => 'keys' },
  {
    pattern: /^failed to handle cert-key pair\[(\d+)\]: (failed to parse key: |failed to decrypt previous encrypted key$)?/,
    path: (m) => `${m[2] ? 'keys' : 'certs'}.${Number(m[1]) - 1}`,
  },
  { pattern: /^failed to validate client_cert: /, path: () => 'client.ca' },
  // A stream route's addresses (stream/router/ip_port.lua) and protocol (stream/xrpc.lua, admin/stream_routes.lua).
  { pattern: /^invalid (remote_addr|server_addr): /, path: (m) => m[1] ?? '' },
  { pattern: /^unknown protocol \[/, path: () => 'protocol.name' },
  { pattern: /^protocol mismatch: /, path: () => 'protocol.name' },
  { pattern: /^(?:stream route can not set itself as superior_id$|failed to fetch stream routes\[)/, path: () => 'protocol.superior_id' },
];

/**
 * The draft path an APISIX save error is about: `uri` for `invalid configuration: property "uri" …`,
 * `plugins.proxy-rewrite` for `failed to check the configuration of plugin proxy-rewrite err: …`,
 * `upstream_id` for a missing upstream, and so on (see ERROR_PATHS). Undefined when the message
 * names no field for certain, e.g. "only one of host or hosts is allowed".
 */
export function pathOfError(message: string | undefined): string | undefined {
  if (message === undefined) return undefined;
  for (const { pattern, path } of ERROR_PATHS) {
    const m = pattern.exec(message);
    if (m) return path(m) || undefined;
  }
  return undefined;
}

/** What idIssues needs of a kind's registry entry. */
interface IdRules {
  singular: string;
  idFromDraft?(draft: Obj): string | undefined;
}

/**
 * The frame's own checks of the id: a stored object's id can't change (path `id`, or `''` for kinds
 * whose id is a body field); a new object's id typed into the JSON must match the ID field.
 */
export function idIssues(def: IdRules, draft: Obj, a: { id?: string; isNew: boolean; newId: string; typedId?: string }): Issue[] {
  const list: Issue[] = [];
  const { id, isNew, newId, typedId } = a;
  if (!isNew && id !== undefined) {
    const own = def.idFromDraft ? def.idFromDraft(draft) : typedId;
    if (own !== undefined && own !== id) list.push({ path: def.idFromDraft ? '' : 'id', message: t('editor.id.changed', { id, kind: def.singular }) });
  }
  if (isNew && !def.idFromDraft && newId.trim() !== '' && typedId !== undefined && typedId !== newId.trim()) {
    list.push({ path: 'id', message: t('editor.id.mismatch', { json: typedId, id: newId.trim() }) });
  }
  return list;
}
