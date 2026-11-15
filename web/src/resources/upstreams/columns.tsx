// The upstreams list columns. Accessors return plain values for sorting (strings, numbers, string
// arrays); cells present them (../cells.tsx).
import { isObj } from '../../api/sanitize';
import type { Item, Obj } from '../../api/types';
import { t } from '../../i18n';
import { Lines } from '../../table/cells';
import { balancerLabel, DEFAULT_SCHEME, DEFAULT_TYPE } from '../../upstream/meta';
import { addrOf, rowsOf, usesDiscovery } from '../../upstream/nodes';
import { IdCell, LabelChips, NameDescCell, TimeCell, UsedByCell } from '../cells';
import type { Ctx } from '../ctx';
import type { ColumnDef } from '../registry';
import { labelPairs, nameOfValue, referencesTo, type Reference } from '../resolve';

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const time = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/** The balancer, `roundrobin` when unset (APISIX's default). */
export const typeOf = (up: Obj): string => str(up.type) ?? DEFAULT_TYPE;

/** The scheme, `http` when unset (APISIX's default). */
export const schemeOf = (up: Obj): string => str(up.scheme) ?? DEFAULT_SCHEME;

/** `host:port` per node, or `consul: billing` for a discovery upstream. */
function nodeLines(up: Obj): string[] {
  if (usesDiscovery(up)) return [`${str(up.discovery_type) ?? '?'}: ${str(up.service_name) ?? '?'}`];
  return rowsOf(up.nodes).map((row) => row.addr ?? addrOf(row.host ?? '?', row.port));
}

export type HealthState = 'active' | 'both' | 'off';

/** Which health checks run: active, active + passive, or none. */
export function healthOf(up: Obj): HealthState {
  const checks = isObj(up.checks) ? up.checks : {};
  if (!isObj(checks.active)) return 'off';
  return isObj(checks.passive) ? 'both' : 'active';
}

export const healthLabel = (state: HealthState): string => (state === 'off' ? t('ui.off') : t(`up.health.${state}`));

/** The lists that can point at an upstream (referencesTo: routes, services, stream routes, and a traffic-split rule in a plugin config, consumer or consumer group). */
export const USAGE_LISTS = ['routes', 'services', 'streamRoutes', 'pluginConfigs', 'consumers', 'consumerGroups'] as const;

/**
 * What points at the upstream: the references once every list that can has loaded; 'unknown' when one
 * of them failed to load (it can't be told), else 'loading' (addendum rule 12; with stream mode off,
 * the stream routes count as loaded).
 */
export function usedBy(item: Item, ctx: Ctx): Reference[] | 'loading' | 'unknown' {
  if (USAGE_LISTS.every((list) => ctx.loaded[list])) return referencesTo('upstreams', item.id, ctx);
  return USAGE_LISTS.some((list) => ctx.failed[list] && !ctx.loaded[list]) ? 'unknown' : 'loading';
}

// Headers are getters, so they follow the language table at use (never spread a column). The
// default columns, with the checkbox (34) and actions (40) columns, fit the 1010px a 1280px window
// leaves beside the sidebar.
export const upstreamColumns: ColumnDef[] = [
  {
    id: 'name',
    get header() {
      return t('column.name');
    },
    accessor: (item) => nameOfValue(item.value) ?? item.id,
    cell: (item) => <NameDescCell kind="upstreams" item={item} />,
    defaultVisible: true,
    width: 190,
  },
  {
    id: 'type',
    get header() {
      return t('column.type');
    },
    accessor: (item) => typeOf(item.value),
    cell: (item) => {
      const type = typeOf(item.value);
      const on = str(item.value.hash_on) ?? 'vars';
      return (
        <>
          <span className="tbl-line">{balancerLabel(type)}</span>
          {type === 'chash' && (
            <span className="cell-sub mono" title={`${on} ${str(item.value.key) ?? ''}`}>
              {on === 'consumer' ? on : `${on} ${str(item.value.key) ?? '?'}`}
            </span>
          )}
        </>
      );
    },
    defaultVisible: true,
    width: 150,
  },
  {
    id: 'nodes',
    get header() {
      return t('column.nodes');
    },
    accessor: (item) => nodeLines(item.value),
    cell: (item) => <Lines lines={nodeLines(item.value)} mono />,
    defaultVisible: true,
    width: 230,
  },
  {
    id: 'scheme',
    get header() {
      return t('column.scheme');
    },
    accessor: (item) => schemeOf(item.value),
    defaultVisible: true,
    width: 84,
    mono: true,
  },
  {
    id: 'used_by',
    get header() {
      return t('column.used_by');
    },
    accessor: (item, ctx) => {
      const refs = usedBy(item, ctx);
      return typeof refs === 'string' ? undefined : refs.length;
    },
    cell: (item, ctx) => {
      const refs = usedBy(item, ctx);
      if (typeof refs !== 'string') return <UsedByCell refs={refs} />;
      return <span className="cell-muted">{refs === 'unknown' ? t('cell.usedBy.unknown') : t('picker.loading')}</span>;
    },
    defaultVisible: true,
    width: 90,
  },
  {
    id: 'updated',
    get header() {
      return t('column.updated');
    },
    accessor: (item) => time(item.value.update_time),
    cell: (item) => <TimeCell epoch={item.value.update_time} />,
    defaultVisible: true,
    width: 88,
  },
  {
    id: 'id',
    get header() {
      return t('column.id');
    },
    accessor: (item) => item.id,
    cell: (item) => <IdCell id={item.id} />,
    defaultVisible: false,
    width: 160,
    mono: true,
  },
  {
    id: 'desc',
    get header() {
      return t('column.desc');
    },
    accessor: (item) => item.value.desc,
    defaultVisible: false,
    width: 220,
  },
  {
    id: 'retries',
    get header() {
      return t('column.retries');
    },
    accessor: (item) => (typeof item.value.retries === 'number' ? item.value.retries : undefined),
    defaultVisible: false,
    width: 84,
  },
  {
    id: 'health',
    get header() {
      return t('column.health');
    },
    accessor: (item) => healthLabel(healthOf(item.value)),
    defaultVisible: false,
    width: 130,
  },
  {
    id: 'pass_host',
    get header() {
      return t('column.pass_host');
    },
    accessor: (item) => str(item.value.pass_host),
    defaultVisible: false,
    width: 100,
    mono: true,
  },
  {
    id: 'labels',
    get header() {
      return t('column.labels');
    },
    accessor: (item) => labelPairs(item.value.labels).map(([key, value]) => `${key}:${value}`),
    cell: (item) => <LabelChips pairs={labelPairs(item.value.labels)} />,
    defaultVisible: false,
    width: 180,
  },
  {
    id: 'created',
    get header() {
      return t('column.created');
    },
    accessor: (item) => time(item.value.create_time),
    cell: (item) => <TimeCell epoch={item.value.create_time} />,
    defaultVisible: false,
    width: 88,
  },
];
