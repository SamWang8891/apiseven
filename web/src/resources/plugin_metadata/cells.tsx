// The plugin metadata list's cells: the state (and a flag for an entry whose plugin isn't known or
// declares no metadata), and a one-line summary of what is stored, its secrets masked.
import { usePluginsIfLoaded } from '../../api/hooks';
import { t } from '../../i18n';
import { redactObject } from '../../plugins/secrets';
import { pluginSummary } from '../../plugins/summary';
import { Badge } from '../../ui';
import { withoutId } from '../withoutId';
import { stateLabel, type MetadataRow } from './rows';

export function StateCell({ item }: { item: MetadataRow }) {
  return (
    <span className="cell-chips">
      <Badge tone={item.configured ? 'ok' : 'neutral'}>{stateLabel(item)}</Badge>
      {item.flag && (
        <Badge tone="warn" title={t(item.flag === 'unknown' ? 'pm.state.unknownWhy' : 'pm.state.noSchemaWhy')}>
          {t(item.flag === 'unknown' ? 'pm.state.unknown' : 'pm.state.noSchema')}
        </Badge>
      )}
    </span>
  );
}

/** What is stored, in one line, its secrets masked with the plugin list a page has loaded (all of it masked without). */
export function SummaryCell({ item }: { item: MetadataRow }) {
  const all = usePluginsIfLoaded();
  if (!item.stored) return <span className="cell-muted">{t('ui.empty')}</span>;
  const masked = redactObject(item.stored.value, 'plugin_metadata', all, item.id).value;
  const text = pluginSummary(item.id, withoutId(masked));
  return (
    <span className="tbl-line mono" title={text}>
      {text}
    </span>
  );
}

