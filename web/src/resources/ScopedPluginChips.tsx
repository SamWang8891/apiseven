// A consumer's, credential's or consumer group's plugin chips in a list (scopedPlugins), deciding
// what is an auth plugin from the plugin list when an editor has already loaded it.
import type { Obj } from '../api/types';
import { usePluginsIfLoaded } from '../api/hooks';
import { PluginChips } from './cells';
import { scopedPlugins, type PluginOwner } from './scopedPlugins';

export function ScopedPluginChips({ value, owner }: { value: Obj; owner: PluginOwner }) {
  const all = usePluginsIfLoaded();
  return <PluginChips plugins={scopedPlugins(value, owner, all)} />;
}
