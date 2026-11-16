// What one entry of an object's plugins does, for every view that names it outside its card: a list's
// Plugins chips, an overview's plugin names, the inherited-plugins rows. One rule, so no view says
// "off" of a plugin that keeps running (addendum rule 18).
import type { PluginInfo } from '../api/types';
import { isDisabled } from './meta';
import { runsForInstance } from './scope';

/**
 * What the entry `name: conf` does where it is stored:
 * - 'noEffect': a plugin APISIX runs for the whole instance (runsForInstance, scope.ts): the entry does
 *   nothing, on or off. A caller shows "No effect here" (`t('pl.card.instance')`) and never "off" or
 *   "disabled", whatever its `_meta.disable`; nor does it dim it as not running.
 * - 'off': `_meta.disable` is set, and APISIX skips the plugin for this object (plugin.filter,
 *   apisix/plugin.lua 595–597): "off".
 * - 'on': any other entry.
 * `info` is the plugin as this APISIX reports it, once the list has loaded (a custom plugin it reports
 * as `scope: "global"`); without it the built-in names decide.
 */
export function entryEffect(name: string, conf: unknown, info?: PluginInfo): 'noEffect' | 'off' | 'on' {
  if (runsForInstance(name, info)) return 'noEffect';
  return isDisabled(conf) ? 'off' : 'on';
}
