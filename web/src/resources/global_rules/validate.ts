// What APISIX 3.20 refuses in a global rule, checked in the browser so Save can say where: the
// `global_rule` schema in apisix/schema_def.lua (1021–1034: `plugins` required, an object) and
// check_conf in apisix/admin/global_rules.lua (48–57: each plugin against its schema). Its other
// refusal, a plugin another global rule already holds (59–83), depends on the stored rules at the
// moment of the save, so it is a note on the Plugins tab (PluginsBody), not a block: a list read
// earlier could refuse what APISIX takes. Pure; the registry uses it as the rule's `validate`.
import { isLuaObject } from '../../api/lua';
import type { Obj } from '../../api/types';
import type { Issue } from '../../editor/issues';
import { t } from '../../i18n';
import { pluginIssues } from '../../plugins/validate';
import type { ValidateEnv } from '../registry';

/** Problems in a global rule draft, each at its path, for the editor to show on the right tab. */
export function globalRuleIssues(draft: Obj, env: ValidateEnv): Issue[] {
  const issues: Issue[] = [];
  // required = {"id", "plugins"} (1032), plugins_schema = {type = "object"} (23–25); the id is the
  // URL's. An empty table is an object to APISIX.
  if (!isLuaObject(draft.plugins)) issues.push({ path: 'plugins', message: t('gr.issue.plugins'), tab: 'plugins' });
  issues.push(...pluginIssues(draft, env, 'global_rule'));
  return issues;
}
