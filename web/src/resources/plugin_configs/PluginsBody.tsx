// The plugin config editor's Plugins tab: how its plugins combine with a route's (plugin_config.lua
// merge, 67–96, at 86–90: the route's own entry for a plugin wins, whatever it says, so a route with
// the plugin switched off runs none), then the plugin cards. The route editor says the same
// (rt.pl.configHelp).
import { t } from '../../i18n';
import { DraftPluginsTab } from '../../plugins/PluginsTab';
import type { TabProps } from '../registry';
import '../resources.css';

export function PluginsBody(p: TabProps) {
  return (
    <div className="ed-stack">
      <p className="res-note">{t('pc.plugins.help')}</p>
      <DraftPluginsTab {...p} scope="plugin_config" />
    </div>
  );
}
