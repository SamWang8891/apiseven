// Client-side checks of plugin configs against the schemas the connected APISIX publishes, so a
// broken config is caught (and shown on its card) before Save. APISIX stays the final authority:
// a schema Ajv cannot compile gives no issues.
import { isObj } from '../api/sanitize';
import type { Obj, PluginInfo } from '../api/types';
import type { Issue } from '../editor/issues';
import { t } from '../i18n';
import type { ValidateEnv } from '../resources/registry';
import { fieldErrors } from '../schema/ajv';
import { isDisabled, META, metaOf, withoutMeta } from './meta';
import { schemaFor, type Scope } from './scope';

export interface PluginIssue {
  plugin: string;
  /** Dotted, relative to the plugin's config ('' = the config as a whole). */
  path: string;
  message: string;
}

/** Whether the schema has a `_meta` property (APISIX injects one into every route-side schema). */
const declaresMeta = (schema: Obj): boolean => isObj(schema.properties) && Object.hasOwn(schema.properties, META);

/**
 * What is wrong with each plugin's config in `scope`, against `all` (the scope's plugin set):
 * - a plugin this APISIX has not loaded: one issue at the config's root;
 * - in a credential, a plugin that is not an auth plugin (APISIX refuses those there);
 * - a config that is not an object: one issue at its root;
 * - otherwise the schema's complaints (configErrors), unless the plugin is switched off
 *   (`_meta.disable: true`): APISIX accepts a switched-off plugin whose config fails its schema
 *   (check_single_plugin_schema, apisix/plugin.lua 1033–1046, "accepting it anyway"). The card
 *   says what would be refused once it is switched on.
 * What APISIX still refuses of a switched-off plugin is kept: the three above (a config that is not
 * a table, plugin.lua 1011–1015; an unknown plugin, 1017–1028; a credential's non-auth one,
 * admin/credentials.lua 38–45) and, outside a stream route, a `_meta.filter` that is not a list
 * (expr.new compiles it, 1048–1054) and a `_meta.pre_function` that is not text (it is loaded as
 * Lua, 1056–1064). A stream route's plugins are checked by stream_check_schema (1335–1371), which
 * does neither.
 */
export function validatePlugins(plugins: Record<string, Obj>, all: Record<string, PluginInfo>, scope: Scope): PluginIssue[] {
  const out: PluginIssue[] = [];
  for (const [plugin, conf] of Object.entries(plugins)) {
    const info = all[plugin];
    if (!info) {
      out.push({ plugin, path: '', message: t('pl.issue.unknown') });
      continue;
    }
    if (scope === 'credential' && info.type !== 'auth') {
      out.push({ plugin, path: '', message: t('pl.issue.credentialAuth') });
      continue;
    }
    if (!isObj(conf)) {
      out.push({ plugin, path: '', message: t('pl.issue.notObject') });
      continue;
    }
    if (isDisabled(conf)) {
      if (scope !== 'stream_route') for (const error of offMetaErrors(conf)) out.push({ plugin, ...error });
      continue;
    }
    for (const error of configErrors(conf, info, scope)) out.push({ plugin, ...error });
  }
  return out;
}

/** Set, as Lua's `if x then` sees it: anything but absent or false (a JSON null arrives as cjson.null, which is set). */
const isSet = (value: unknown): boolean => value !== undefined && value !== false;

/**
 * What APISIX refuses in a switched-off plugin's `_meta` (plugin.lua 1048–1064): a filter that
 * expr.new can't take (not a table: a JSON list, or an object), a pre_function that isn't text.
 * Whether a list's conditions compile, or the text is valid Lua, is APISIX's to say on save.
 */
function offMetaErrors(conf: Obj): { path: string; message: string }[] {
  const meta = metaOf(conf);
  if (!meta) return [];
  const out: { path: string; message: string }[] = [];
  if (isSet(meta.filter) && (typeof meta.filter !== 'object' || meta.filter === null)) out.push({ path: `${META}.filter`, message: t('pl.issue.filterOff') });
  if (isSet(meta.pre_function) && typeof meta.pre_function !== 'string') out.push({ path: `${META}.pre_function`, message: t('pl.issue.preFunctionOff') });
  return out;
}

/**
 * The schema's complaints about one plugin's config in `scope`, switched off or not
 * (schema/ajv fieldErrors: dotted paths, a missing required property at its own path). `_meta` is
 * checked only by a schema that declares it, so a schema that forbids extra properties (a consumer
 * schema, an older APISIX) never reports it.
 */
export function configErrors(conf: unknown, info: PluginInfo, scope: Scope): { path: string; message: string }[] {
  const schema = schemaFor(info, scope);
  const value = isObj(conf) && !declaresMeta(schema) ? withoutMeta(conf) : conf;
  return fieldErrors(schema, value) ?? [];
}

/**
 * validatePlugins for a draft's `plugins`, as editor issues: path `plugins.<name>[.<field>]`, on the
 * Plugins tab. The stream route scope checks against `env.streamPlugins`, the others against
 * `env.plugins`; nothing is reported until that set has loaded.
 */
export function pluginIssues(draft: Obj, env: ValidateEnv, scope: Scope): Issue[] {
  const all = scope === 'stream_route' ? env.streamPlugins : env.plugins;
  if (!all || !isObj(draft.plugins)) return [];
  return validatePlugins(draft.plugins as Record<string, Obj>, all, scope).map(({ plugin, path, message }) => ({
    path: path === '' ? `plugins.${plugin}` : `plugins.${plugin}.${path}`,
    message,
    tab: 'plugins',
  }));
}
