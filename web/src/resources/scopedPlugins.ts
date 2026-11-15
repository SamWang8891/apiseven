// An object's own plugins as its list shows them, with what "off" and auth plugins mean where it
// lives (plugins/auth.ts): a consumer's or credential's auth plugin stored as off still signs in when
// it has the field it matches by (signInOf), and signs nobody in without it; a consumer group's auth
// plugin never runs its sign-in step for the group's consumers. A plugin that may or may not be an
// auth plugin (not built in, the plugin list not loaded) is marked unclassified: nothing definite.
import { isObj } from '../api/sanitize';
import type { Obj, PluginInfo } from '../api/types';
import { authPluginOrUnknown, signInOf } from '../plugins/auth';
import type { PluginChip } from './cells';
import { servicePlugins } from './services/columns';

export type PluginOwner = 'consumer' | 'credential' | 'consumer_group';

/** The plugins by name; `all` is the plugin list when loaded (else the source's lists decide what they can). */
export function scopedPlugins(value: Obj, owner: PluginOwner, all?: Record<string, PluginInfo>): PluginChip[] {
  const confs = isObj(value.plugins) ? value.plugins : {};
  return servicePlugins(value).map((p) => {
    // Every plugin of a credential is an auth plugin: APISIX refuses any other (admin/credentials.lua 38–45).
    const auth = owner === 'credential' ? true : authPluginOrUnknown(p.name, all);
    if (auth === undefined) return { ...p, unclassified: true };
    if (!auth) return p;
    if (owner === 'consumer_group') return { ...p, notApplied: true };
    const { state } = signInOf(p.name, confs[p.name], all?.[p.name]);
    if (state === 'stillSignsIn') return { name: p.name, stillSignsIn: true };
    if (state === 'offIgnored') return { name: p.name, offIgnored: true };
    // On, or off without the field it matches by: then it signs nobody in, and "off" is what it is.
    return p;
  });
}
