// An object's own plugins as its list shows them, with what "off" and auth plugins mean where it
// lives (plugins/auth.ts): a consumer's or credential's auth plugin stored as off still signs in
// (jwe-decrypt: is still used) when it has what it is found by and checked against, and signs nobody
// in without it (signInOf); one this APISIX doesn't know is not used; a consumer group's auth plugin
// never runs its sign-in step for the group's consumers. A plugin that may or may not be an auth
// plugin (not built in, the plugin list not loaded) is marked unclassified: nothing definite.
import { isObj } from '../api/sanitize';
import type { Obj, PluginInfo } from '../api/types';
import { authPluginOrUnknown, signInOf, signInRole } from '../plugins/auth';
import type { PluginChip } from './cells';
import { servicePlugins } from './services/columns';

export type PluginOwner = 'consumer' | 'credential' | 'consumer_group';

/** The plugins by name; `all` is the plugin list when loaded (else the source's lists decide what they can). */
export function scopedPlugins(value: Obj, owner: PluginOwner, all?: Record<string, PluginInfo>): PluginChip[] {
  const confs = isObj(value.plugins) ? value.plugins : {};
  return servicePlugins(value, all).map((p) => {
    if (owner === 'consumer_group') {
      const auth = authPluginOrUnknown(p.name, all);
      return auth === undefined ? { ...p, unclassified: true } : auth ? { ...p, notApplied: true } : p;
    }
    const role = signInRole(owner, p.name, all?.[p.name], all !== undefined);
    if (role === 'unknown') return { ...p, unclassified: true };
    if (role === 'unused') return { name: p.name, notUsed: true };
    if (role === undefined) return p;
    const { state } = signInOf(p.name, confs[p.name]);
    if (state === 'stillSignsIn') return { name: p.name, stillSignsIn: true };
    if (state === 'offIgnored') return { name: p.name, offIgnored: true };
    // On, or off without what it is found by or checked against: then it signs nobody in, and "off" is what it is.
    return p;
  });
}
