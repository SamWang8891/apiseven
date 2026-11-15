// Client-side checks of plugin configs against the schemas the connected APISIX publishes, so a
// broken config is caught (and shown on its card) before Save. APISIX stays the final authority:
// a schema Ajv cannot compile gives no issues.
import { isObj } from '../api/sanitize';
import type { Obj, PluginInfo } from '../api/types';
import type { Issue } from '../editor/issues';
import { t } from '../i18n';
import type { ValidateEnv } from '../resources/registry';
import { fieldErrors } from '../schema/ajv';
import { isDisabled, META, withoutMeta } from './meta';
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
 * - otherwise the schema's complaints (configErrors), unless the plugin is switched off
 *   (`_meta.disable: true`): APISIX accepts a switched-off plugin whose config fails its schema
 *   (check_single_plugin_schema, apisix/plugin.lua 1033–1046, "accepting it anyway"; it still
 *   refuses an unknown plugin, 1018–1031, and a credential's non-auth one, admin/credentials.lua
 *   38–45). The card says what would be refused once it is switched on.
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
    if (isDisabled(conf)) continue;
    for (const error of configErrors(conf, info, scope)) out.push({ plugin, ...error });
  }
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
