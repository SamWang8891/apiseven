// Where requests go: a fixed list of nodes, or the nodes a service registry reports. The switch
// between the two removes the other's fields (APISIX takes exactly one). A switch to discovery
// with nothing typed yet is remembered here only, since the upstream then holds neither.
import { useState } from 'react';
import { isObj } from '../api/sanitize';
import { setPath, setPathRaw } from '../editor/draft';
import { t } from '../i18n';
import { Segmented, useLocked } from '../ui';
import { Discovery } from './Discovery';
import { IssueLine } from './fields';
import type { SectionProps } from './values';
import { usesDiscovery } from './nodes';
import { NodesTable } from './NodesTable';

type Mode = 'nodes' | 'discovery';
const DISCOVERY_FIELDS = ['discovery_type', 'service_name', 'discovery_args'];

export function NodesSection(p: SectionProps) {
  const { value, onChange, issues } = p;
  const locked = useLocked();
  const [chosen, setChosen] = useState<Mode>();
  const neither = value.nodes === undefined && !usesDiscovery(value);
  const mode: Mode = usesDiscovery(value) ? 'discovery' : neither ? (chosen ?? 'nodes') : 'nodes';

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
