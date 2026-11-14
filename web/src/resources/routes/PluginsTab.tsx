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
import { ResourcePicker } from '../ResourcePicker';
import './routes.css';

const idOf = (v: unknown): string | undefined => (typeof v === 'number' ? String(v) : typeof v === 'string' && v !== '' ? v : undefined);

export function RoutePluginsTab({ draft, setDraft, issues, ctx, saveAttempts }: TabProps) {
  const locked = useLocked();
  const configId = idOf(draft.plugin_config_id);
  return (
    <div className="ed-stack">
      {draft.script !== undefined && <p className="rt-note rt-note--warn">{t('rt.pl.scriptNote')}</p>}
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
      />
    </div>
  );
}
