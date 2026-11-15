// What APISIX 3.20 refuses in a consumer group, checked in the browser so Save can say where: the
// `consumer_group` schema in apisix/schema_def.lua (1177–1193: `plugins` required, an object) and
// check_conf in apisix/admin/consumer_group.lua (27–39: each plugin against its route-side schema,
// as no schema type is passed). The id comes from the ID field and the URL. Pure; the registry uses
// it as the group's `validate`.
import { isLuaObject } from '../../api/lua';
import type { Obj } from '../../api/types';
import type { Issue } from '../../editor/issues';
import { t } from '../../i18n';
import { pluginIssues } from '../../plugins/validate';
import type { ValidateEnv } from '../registry';
import { labelsRefused } from '../routes/validate';

/** Problems in a consumer group draft, each at its path, for the editor to show on the right tab. */
export function consumerGroupIssues(draft: Obj, env: ValidateEnv): Issue[] {
  const issues: Issue[] = [];
  if (labelsRefused(draft.labels)) issues.push({ path: 'labels', message: t('rt.issue.labels') });
  // required = {"id", "plugins"} (1191); the id is the URL's. An empty table is an object to APISIX.
  if (!isLuaObject(draft.plugins)) issues.push({ path: 'plugins', message: t('cg.issue.plugins'), tab: 'plugins' });
  issues.push(...pluginIssues(draft, env, 'consumer_group'));
  return issues;
}
