// Service discovery: which registry, which service, and the arguments the discovery module reads
// (nacos: namespace_id, group_name; kubernetes: cluster_ids). Any other argument with a text value
// is edited as a key-value pair; others are kept and named, for the JSON tab.
import { useId } from 'react';
import type { Obj } from '../api/types';
import { setPath } from '../editor/draft';
import { t } from '../i18n';
import { KeyValueInput, TagInput, useLocked } from '../ui';
import { TextField } from './fields';
import { bind, obj, str, type SectionProps } from './values';

/** The discovery modules APISIX 3.20 ships (apisix/discovery/*). */
const MODULES = ['dns', 'consul', 'consul_kv', 'nacos', 'eureka', 'kubernetes', 'tars'];
const KNOWN_ARGS = ['namespace_id', 'group_name', 'cluster_ids'];

export function Discovery(p: SectionProps) {
  const { value, onChange } = p;
  const { set, issue } = bind(p);
  const locked = useLocked();
  const listId = useId();
  const type = str(value.discovery_type);
  const args = obj(value.discovery_args);
  const setArgs = (next: Obj) => onChange(setPath(value, ['discovery_args'], next));
  const other = Object.fromEntries(Object.entries(args).filter((e): e is [string, string] => !KNOWN_ARGS.includes(e[0]) && typeof e[1] === 'string'));
  const unshown = Object.keys(args).filter((key) => !KNOWN_ARGS.includes(key) && typeof args[key] !== 'string');
  const nacos = type === 'nacos' || args.namespace_id !== undefined || args.group_name !== undefined;
  const kubernetes = type === 'kubernetes' || args.cluster_ids !== undefined;
  const clusters = Array.isArray(args.cluster_ids) ? args.cluster_ids.filter((id): id is string => typeof id === 'string') : [];

  return (
    <div className="ed-grid">
      <TextField
        label={t('up.discovery.type')}
        mono
        list={listId}
        autoComplete="off"
        value={type ?? ''}
        help={t('up.discovery.typeHelp')}
        error={issue('discovery_type')}
        onChange={(e) => set(['discovery_type'], e.target.value)}
      />
      {!locked && (
        <datalist id={listId}>
          {MODULES.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      )}
      <TextField
        label={t('up.discovery.service')}
        mono
        autoComplete="off"
        value={str(value.service_name) ?? ''}
        help={t('up.discovery.serviceHelp')}
        error={issue('service_name')}
        onChange={(e) => set(['service_name'], e.target.value)}
      />
      {nacos && (
        <>
          <TextField
            label={t('up.discovery.namespace')}
            mono
            byDefault="public"
            value={str(args.namespace_id) ?? ''}
            error={issue('discovery_args.namespace_id')}
            onChange={(e) => set(['discovery_args', 'namespace_id'], e.target.value)}
          />
          <TextField
            label={t('up.discovery.group')}
            mono
            byDefault="DEFAULT_GROUP"
            value={str(args.group_name) ?? ''}
            error={issue('discovery_args.group_name')}
            onChange={(e) => set(['discovery_args', 'group_name'], e.target.value)}
          />
        </>
      )}
      {kubernetes && (
        <div className="ed-wide">
          <TagInput
            label={t('up.discovery.clusters')}
            mono
            value={clusters}
            help={locked ? undefined : t('up.discovery.clustersHelp')}
            error={issue('discovery_args.cluster_ids')}
            onChange={(ids) => set(['discovery_args', 'cluster_ids'], ids)}
          />
        </div>
      )}
      {(!locked || Object.keys(other).length > 0) && (
        <div className="ed-wide">
          <KeyValueInput
            label={t('up.discovery.other')}
            mono
            value={other}
            error={issue('discovery_args')}
            onChange={(map) => {
              // Rebuilt in place: the known arguments and the ones not shown here stay.
              const kept = Object.fromEntries(Object.entries(args).filter(([key, v]) => KNOWN_ARGS.includes(key) || typeof v !== 'string'));
              setArgs({ ...kept, ...map });
            }}
          />
        </div>
      )}
      {unshown.length > 0 && <p className="ed-note ed-wide">{t('up.discovery.unshown', { keys: unshown.join(', ') })}</p>}
    </div>
  );
}
