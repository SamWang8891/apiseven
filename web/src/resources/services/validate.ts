// What APISIX 3.20 refuses in a service, checked in the browser so Save can say where: the `service`
// schema in apisix/schema_def.lua (761–789: hosts, labels) and check_conf in apisix/admin/services.lua
// (an upstream_id that must exist, the inline upstream through check_upstream_conf, the plugins).
// Nothing stricter (`serviceIssues` runs on the whole draft, the JSON tab's too): a service may have
// no upstream, no hosts and no plugins. A host is checked as typed by the General tab's tag box,
// with the same rule (hostProblem). Pure; the registry uses it as the service's `validate`.
import { isObj } from '../../api/sanitize';
import type { Obj } from '../../api/types';
import type { Issue } from '../../editor/issues';
import { t } from '../../i18n';
import { pluginIssues } from '../../plugins/validate';
import { upstreamIssues } from '../../upstream/validate';
import type { ValidateEnv } from '../registry';
import { resolveRef } from '../resolve';
import { hostProblem, labelsRefused } from '../routes/validate';

/** Problems in a service draft, each at its path, for the editor to show on the right tab. */
export function serviceIssues(draft: Obj, env: ValidateEnv): Issue[] {
  const issues: Issue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });

  // hosts (schema_def.lua 781–786): a list of host_def (57–61), at least one, no repeats.
  const hosts = draft.hosts;
  if (hosts !== undefined) {
    if (!Array.isArray(hosts)) add('hosts', t('svc.issue.hostsList'));
    else if (hosts.length === 0) add('hosts', t('svc.issue.hostsEmpty'));
    else {
      const seen = new Set<unknown>();
      hosts.forEach((host: unknown, i) => {
        const problem = typeof host === 'string' ? hostProblem(host) : t('rt.issue.host', { host: JSON.stringify(host) });
        const message = problem ?? (seen.has(host) ? t('rt.issue.twice', { value: String(host) }) : undefined);
        seen.add(host);
        if (message) add(`hosts.${i}`, message);
      });
    }
  }
  if (labelsRefused(draft.labels)) add('labels', t('rt.issue.labels'));

  // admin/services.lua 48–63: the upstream must exist (known only once the list has loaded).
  const upstream = resolveRef('upstreams', draft.upstream_id, env.ctx);
  if (upstream && !upstream.item && env.ctx.loaded.upstreams) add('upstream_id', t('rt.issue.missing.upstream', { id: upstream.id }));
  // admin/services.lua 40–46: check_upstream_conf, whenever an inline upstream is there.
  if (isObj(draft.upstream)) issues.push(...upstreamIssues(draft.upstream, 'upstream'));
  // admin/services.lua 65–70: the plugins against the http set.
  issues.push(...pluginIssues(draft, env, 'service'));
  return issues;
}
