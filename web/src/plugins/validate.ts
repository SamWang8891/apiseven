// Client-side checks of plugin configs against the schemas the connected APISIX publishes, so a
// broken config is caught (and shown on its card) before Save. APISIX stays the final authority:
// a schema Ajv cannot compile gives no issues.
import { isObj } from '../api/sanitize';
import type { Obj, PluginInfo } from '../api/types';
import type { Issue } from '../editor/issues';
import { t } from '../i18n';
import type { ValidateEnv } from '../resources/registry';
import { fieldErrors } from '../schema/ajv';
import { META, withoutMeta } from './meta';
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
 * - otherwise the schema's complaints (schema/ajv fieldErrors: dotted paths, a missing required
 *   property at its own path). `_meta` is checked only by a schema that declares it, so a schema
 *   that forbids extra properties (a consumer schema, an older APISIX) never reports it.
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
    const schema = schemaFor(info, scope);
    const value = isObj(conf) && !declaresMeta(schema) ? withoutMeta(conf) : conf;
    for (const error of fieldErrors(schema, value) ?? []) out.push({ plugin, ...error });
  }
  return out;
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
