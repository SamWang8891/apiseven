// What APISIX 3.20 refuses in a plugin config, checked in the browser so Save can say where: the
// `plugin_config` schema in apisix/schema_def.lua (1156–1174: `plugins` required, an object; `name`
// text; labels) and check_conf in apisix/admin/plugin_config.lua (27–39: each plugin against its
// schema). Pure; the registry uses it as the plugin config's `validate`.
import { isLuaObject } from '../../api/lua';
import type { Obj } from '../../api/types';
import type { Issue } from '../../editor/issues';
import { t } from '../../i18n';
import { pluginIssues } from '../../plugins/validate';
import type { ValidateEnv } from '../registry';
import { labelsRefused } from '../routes/validate';

/** Problems in a plugin config draft, each at its path, for the editor to show on the right tab. */
export function pluginConfigIssues(draft: Obj, env: ValidateEnv): Issue[] {
  const issues: Issue[] = [];
  // name = {type = "string"} (1161–1163): any text, even empty.
  if (draft.name !== undefined && typeof draft.name !== 'string') issues.push({ path: 'name', message: t('pc.issue.name') });
  // labels_def (108–115), shared with the other kinds.
  if (labelsRefused(draft.labels)) issues.push({ path: 'labels', message: t('rt.issue.labels') });
  // required = {"id", "plugins"} (1172), plugins_schema = {type = "object"} (23–25); an empty table is an object.
  if (!isLuaObject(draft.plugins)) issues.push({ path: 'plugins', message: t('pc.issue.plugins'), tab: 'plugins' });
  issues.push(...pluginIssues(draft, env, 'plugin_config'));
  return issues;
}
