// What APISIX 3.20 refuses in a plugin metadata entry, checked in the browser so Save can say where:
// its plugin's metadata schema (admin/plugin_metadata.lua 49–78: core.schema.check, or the plugin's
// check_schema with TYPE_METADATA, which checks that same schema), through the shared Ajv helper, an
// empty table taken as an object or a list as APISIX's validator does. A plugin this APISIX hasn't
// loaded, or one without a metadata schema, is not checked here: APISIX decides ("invalid plugin
// name", or it takes anything). Pure; the registry uses it as the entry's `validate`.
import type { Obj } from '../../api/types';
import type { Issue } from '../../editor/issues';
import { t } from '../../i18n';
import { fieldErrors } from '../../schema/ajv';
import type { ValidateEnv } from '../registry';
import { withoutId } from '../withoutId';

/** Why `id` can't name a plugin: a slash would split the URL (no plugin has one). */
export function metadataIdProblem(id: string): string | undefined {
  return id.includes('/') ? t('pm.issue.slash', { id }) : undefined;
}

/** Problems in a plugin metadata draft, at their paths, on the Settings tab. */
export function metadataIssues(draft: Obj, env: ValidateEnv): Issue[] {
  const schema = env.id === undefined ? undefined : env.plugins?.[env.id]?.metadata_schema;
  if (!schema) return [];
  return (fieldErrors(schema, withoutId(draft), { luaTables: true }) ?? []).map((error) => ({ ...error, tab: 'config' }));
}
