// Where requests go: a fixed list of nodes, or the nodes a service registry reports. The switch
// between the two removes the other's fields (APISIX takes exactly one). A switch to discovery
// with nothing typed yet is editing state, kept through a tab switch until the editing session ends
// (useSessionViewState), since the upstream then holds neither; locked, the stored value decides.
import { isObj } from '../api/sanitize';
import { setPath, setPathRaw } from '../editor/draft';
import { t } from '../i18n';
import { Segmented, useLocked, useSessionViewState } from '../ui';
import { Discovery } from './Discovery';
import { IssueLine } from './fields';
import type { SectionProps } from './values';
import { rowsOf, usesDiscovery } from './nodes';
import { NodesTable } from './NodesTable';

type Mode = 'nodes' | 'discovery';
const DISCOVERY_FIELDS = ['discovery_type', 'service_name', 'discovery_args'];

export function NodesSection(p: SectionProps) {
  const { value, onChange, issues } = p;
  const locked = useLocked();
  const [chosen, setChosen] = useSessionViewState<Mode | undefined>('upstream.target', undefined);
  const neither = value.nodes === undefined && !usesDiscovery(value);
  const mode: Mode = usesDiscovery(value) ? 'discovery' : neither && !locked ? (chosen ?? 'nodes') : 'nodes';
  // APISIX stores an upstream whose node list is empty (only its schema and check_upstream_conf
  // could refuse it, and neither does), so it is not an issue; but nothing answers until a node is
  // added, which is worth saying, locked or not.
  const noNodes = mode === 'nodes' && value.nodes !== undefined && rowsOf(value.nodes).length === 0;

  function switchTo(next: string) {
    if (next === mode) return;
    setChosen(next as Mode);
    if (next === 'discovery') {
      onChange(setPath(value, ['nodes'], undefined));
    } else {
      const cleared = DISCOVERY_FIELDS.reduce((v, key) => setPath(v, [key], undefined), value);
      onChange(setPathRaw(cleared, ['nodes'], []));
    }
  }

  return (
    <div className="up-nodes">
      {!locked && (
        <Segmented
          label={t('up.target')}
          value={mode}
          onChange={switchTo}
          options={[
            { value: 'nodes', label: t('up.target.nodes') },
            { value: 'discovery', label: t('up.target.discovery') },
          ]}
        />
      )}
      {mode === 'nodes' ? <NodesTable {...p} /> : <Discovery {...p} />}
      {noNodes && <p className="up-warn">{t('up.nodes.emptyNote')}</p>}
      {issues
        .filter((issue) => issue.path === 'nodes')
        .map((issue) => (
          <IssueLine key={issue.message} message={issue.message} />
        ))}
      {mode === 'nodes' && !locked && <p className="up-help">{t('up.nodes.help')}</p>}
      {mode === 'nodes' && !locked && isObj(value.nodes) && <p className="up-help">{t('up.nodes.mapNote')}</p>}
    </div>
  );
}
