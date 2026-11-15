// The route editor's Plugins tab: the plugin config the route uses (its plugins run too), the
// route's own plugin cards, and the plugins it inherits from its service and plugin config.
import { isObj } from '../../api/sanitize';
import type { Obj } from '../../api/types';
import { setPath, setPathRaw } from '../../editor/draft';
import { issueAt, issuesUnder } from '../../editor/issues';
import { t } from '../../i18n';
import { inheritedPlugins } from '../../plugins/inherited';
import { PluginsTab } from '../../plugins/PluginsTab';
import { useLocked } from '../../ui';
import type { TabProps } from '../registry';
import { routeScript } from '../resolve';
import { ResourcePicker } from '../ResourcePicker';
import { inheritLoading } from './inherit';
import './routes.css';

const idOf = (v: unknown): string | undefined => (typeof v === 'number' ? String(v) : typeof v === 'string' && v !== '' ? v : undefined);

export function RoutePluginsTab({ draft, setDraft, issues, ctx, saveAttempts, original }: TabProps) {
  const locked = useLocked();
  const configId = idOf(draft.plugin_config_id);
  const waiting = inheritLoading(draft, ctx);
  // A script runs instead of every plugin: the route's own, or its service's, which it inherits.
  const script = routeScript(draft, ctx);
  return (
    <div className="ed-stack">
      {script === 'route' && <p className="rt-note rt-note--warn">{t('rt.pl.scriptNote')}</p>}
      {script === 'service' && <p className="rt-note rt-note--warn">{t('rt.pl.serviceScriptNote')}</p>}
      {script === 'loading' && <p className="rt-note">{t('rt.pl.serviceScriptLoading')}</p>}
      {script === 'unknown' && <p className="rt-note rt-note--warn">{t('rt.pl.serviceScriptUnknown')}</p>}
      <div className="ed-grid">
        <ResourcePicker
          kind="plugin_configs"
          items={ctx.pluginConfigs}
          loading={!ctx.loaded.pluginConfigs}
          clearable
          label={t('rt.pl.config')}
          help={locked ? undefined : t('rt.pl.configHelp')}
          placeholder={t('rt.pl.noConfig')}
          value={configId}
          error={issueAt(issues, 'plugin_config_id')}
          onChange={(id) => setDraft(setPath(draft, ['plugin_config_id'], id))}
        />
      </div>
      <PluginsTab
        value={isObj(draft.plugins) ? (draft.plugins as Record<string, Obj>) : undefined}
        // Raw: `{}` (a plugin on with its defaults) is kept as it is.
        onChange={(next) => setDraft(setPathRaw(draft, ['plugins'], next))}
        scope="route"
        issues={issuesUnder(issues, 'plugins')}
        saveAttempts={saveAttempts}
        inherited={inheritedPlugins(draft, ctx)}
        stored={isObj(original?.value.plugins) ? original.value.plugins : undefined}
      />
      {(waiting.service || waiting.pluginConfig) && <p className="rt-note">{t('rt.pl.inheritedLoading')}</p>}
    </div>
  );
}
