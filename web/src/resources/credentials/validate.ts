// What APISIX 3.20 refuses in a credential, checked in the browser so Save can say where: the
// `credential` schema in apisix/schema_def.lua (814–845) and check_conf in
// apisix/admin/credentials.lua (25–57). A credential holds at most one plugin (maxProperties 1,
// 836–839), which must be an auth plugin this APISIX has (38–45: validatePlugins). It may hold
// none: nothing requires one, and APISIX stores it (verified live); the Plugins tab says it lets no
// one in. The id comes from the ID field and the URL; its format is APISIX's to judge (the frame
// shows its message). Pure; the registry uses it as the credential's `validate`.
import { isLuaObject } from '../../api/lua';
import { isObj } from '../../api/sanitize';
import type { Obj } from '../../api/types';
import type { Issue } from '../../editor/issues';
import { t } from '../../i18n';
import { pluginIssues } from '../../plugins/validate';
import type { ValidateEnv } from '../registry';
import { labelsRefused } from '../routes/validate';

/** Problems in a credential draft, each at its path, for the editor to show on the right tab. */
export function credentialIssues(draft: Obj, env: ValidateEnv): Issue[] {
  const issues: Issue[] = [];
  if (labelsRefused(draft.labels)) issues.push({ path: 'labels', message: t('rt.issue.labels') });

  const { plugins } = draft;
  if (plugins !== undefined && !isLuaObject(plugins)) issues.push({ path: 'plugins', message: t('cr.issue.pluginsObject'), tab: 'plugins' });
  else if (isObj(plugins) && Object.keys(plugins).length > 1) issues.push({ path: 'plugins', message: t('cr.issue.onePlugin'), tab: 'plugins' });
  issues.push(...pluginIssues(draft, env, 'credential'));
  return issues;
}
