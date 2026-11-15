// An object's own plugins as its list shows them, with what "off" and auth plugins mean where it
// lives (plugins/auth.ts): a consumer's or credential's auth plugin stored as off still signs in; a
// consumer group's auth plugin never runs its sign-in step for the group's consumers.
import type { Obj, PluginInfo } from '../api/types';
import { isAuthPlugin } from '../plugins/auth';
import type { PluginChip } from './cells';
import { servicePlugins } from './services/columns';

export type PluginOwner = 'consumer' | 'credential' | 'consumer_group';

/** The plugins by name; `all` is the plugin list when loaded (else the source's auth list decides). */
export function scopedPlugins(value: Obj, owner: PluginOwner, all?: Record<string, PluginInfo>): PluginChip[] {
  return servicePlugins(value).map((p) => {
    if (!isAuthPlugin(p.name, all)) return p;
    if (owner === 'consumer_group') return { ...p, notApplied: true };
    return p.disabled ? { name: p.name, stillSignsIn: true } : p;
  });
}
