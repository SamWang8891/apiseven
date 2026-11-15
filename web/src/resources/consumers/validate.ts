// What APISIX 3.20 refuses in a consumer, checked in the browser so Save can say where: the
// `consumer` schema in apisix/schema_def.lua (792–812) and check_conf in apisix/admin/consumers.lua
// (24–64: the plugins against their consumer schemas, a group that must exist). Nothing stricter
// (rule 10: consumerIssues runs on the whole draft, the JSON tab's too). Not checked here, so
// APISIX's own message shows: a key another consumer or credential already uses
// (check_duplicate_key, consumer.lua 354–406), which needs every consumer's secrets to judge.
// Pure; the registry uses it as the consumer's `validate`.
import { isLuaObject } from '../../api/lua';
import type { Obj } from '../../api/types';
import type { Issue } from '../../editor/issues';
import { t } from '../../i18n';
import { pluginIssues } from '../../plugins/validate';
import type { ValidateEnv } from '../registry';
import { resolveRef } from '../resolve';
import { labelsRefused } from '../routes/validate';

/** The username pattern of the consumer schema (schema_def.lua 797–800). */
export const USERNAME = /^[a-zA-Z0-9_-]+$/;
/** rule_name_def's maxLength (schema_def.lua 117–121), which the username takes. */
export const USERNAME_MAX = 256;

/** What id_schema takes (schema_def.lua 47–55): letters, digits, - _ . (1–64), or an integer ≥ 1. */
export function isIdShape(v: unknown): boolean {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 1;
  return typeof v === 'string' && v.length >= 1 && v.length <= 64 && /^[a-zA-Z0-9-_.]+$/.test(v);
}

/** Problems in a consumer draft, each at its path, for the editor to show on the right tab. */
export function consumerIssues(draft: Obj, env: ValidateEnv): Issue[] {
  const issues: Issue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });

  // username: required (810), the pattern (797–800), at most 256 (rule_name_def 117–121).
  const { username } = draft;
  if (username === undefined || username === '') add('username', t('cs.issue.username'));
  else if (typeof username !== 'string' || !USERNAME.test(username)) add('username', t('cs.issue.usernamePattern'));
  else if (username.length > USERNAME_MAX) add('username', t('cs.issue.usernameLong'));

  if (labelsRefused(draft.labels)) add('labels', t('rt.issue.labels'));

  // group_id: id_schema (807), then a group that exists (admin/consumers.lua 47–62), known only
  // once the groups have loaded.
  if (draft.group_id !== undefined) {
    if (!isIdShape(draft.group_id)) add('group_id', t('cs.issue.groupId'));
    else {
      const group = resolveRef('consumer_groups', draft.group_id, env.ctx);
      if (group && !group.item && env.ctx.loaded.consumerGroups) add('group_id', t('cs.issue.missingGroup', { id: group.id }));
    }
  }

  // plugins: plugins_schema, an object (808; an empty table is one), then each against its consumer
  // schema (admin/consumers.lua 35–39).
  if (draft.plugins !== undefined && !isLuaObject(draft.plugins)) issues.push({ path: 'plugins', message: t('cr.issue.pluginsObject'), tab: 'plugins' });
  issues.push(...pluginIssues(draft, env, 'consumer'));
  return issues;
}
