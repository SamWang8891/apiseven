// What APISIX 3.20 refuses in a secret manager entry, checked in the browser so Save can say where:
// its manager's schema (admin/secrets.lua 35–38, core.schema.check(secret_manager.schema, conf); the
// schemas in schemas.ts, transcribed from apisix/secret/*.lua), through the shared Ajv helper, with
// an empty table taken as either an object or a list as APISIX's validator takes it. Nothing else is
// checked there: the id is (admin/resource.lua 87–111) only made "<manager>/<id>". A manager APISIX
// doesn't have is the ID field's problem (NewSecretId). Pure; the registry uses it as `validate`.
import type { Obj } from '../../api/types';
import type { Issue } from '../../editor/issues';
import { t } from '../../i18n';
import { fieldErrors } from '../../schema/ajv';
import type { ValidateEnv } from '../registry';
import { withoutId } from '../withoutId';
import { isManager, managerOf, SCHEMAS, splitSecretId } from './schemas';

/** Why APISIX can't take `id` as a secret's id as it is; the message names the field. */
export function secretIdProblem(id: string): string | undefined {
  const { manager, name } = splitSecretId(id);
  // admin/secrets.lua 30–33: "invalid secret manager"; resource.lua 44–52 and 260–270: the id is the
  // first path segment after the manager, so anything after a slash would be dropped.
  if (!isManager(manager)) return t('sc.id.noManager');
  if (name === '') return t('sc.id.empty');
  if (name === '.' || name === '..') return t('editor.id.segment', { id });
  if (name.includes('/')) return t('sc.id.slash', { id: name });
  return undefined;
}

/** Problems in a secret draft, at their paths, on the Settings tab. */
export function secretIssues(draft: Obj, env: ValidateEnv): Issue[] {
  const manager = managerOf(env.id ?? (typeof draft.id === 'string' ? draft.id : undefined));
  if (!manager) return [];
  return (fieldErrors(SCHEMAS[manager], withoutId(draft), { luaTables: true }) ?? []).map((error) => ({ ...error, tab: 'config' }));
}
