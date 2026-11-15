// The stream routes list columns. Accessors return plain values for sorting (strings, numbers, string
// arrays); cells present them (../cells.tsx). A stream route has no status.
import type { Obj } from '../../api/types';
import { t } from '../../i18n';
import { Empty, Lines } from '../../table/cells';
import { IdCell, LabelChips, NameDescCell, PluginChips, RefCell, TimeCell, UpstreamCell } from '../cells';
import type { ColumnDef } from '../registry';
import { effectivePlugins, labelPairs, nameOfValue, resolveRef, upstreamSummary } from '../resolve';
import { pluginChips, refName } from '../routes/columns';
import { readPair } from '../routes/pairs';

const time = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

/** The SNIs the route matches: `sni`, or the list `snis` (the schema refuses both). */
export const snisOf = (route: Obj): string[] => readPair(route, 'sni', 'snis');

// Headers are getters, so they follow the language table at use (never spread a column). The
// default columns, with the checkbox (34) and actions (40) columns, fit the 1010px a 1280px window
// leaves beside the sidebar; each fits a full IPv4 CIDR, a 5-digit port and a 20-character SNI.
export const streamRouteColumns: ColumnDef[] = [
  {
    id: 'name',
    get header() {
      return t('column.name');
    },
    accessor: (item) => nameOfValue(item.value) ?? item.id,
    cell: (item) => <NameDescCell kind="stream_routes" item={item} />,
    defaultVisible: true,
    width: 136,
  },
  {
    id: 'server_addr',
    get header() {
      return t('column.server_addr');
    },
    accessor: (item) => str(item.value.server_addr),
    defaultVisible: true,
    width: 140,
    mono: true,
  },
  {
    id: 'server_port',
    get header() {
      return t('column.server_port');
    },
    accessor: (item) => (typeof item.value.server_port === 'number' ? item.value.server_port : undefined),
    defaultVisible: true,
    width: 66,
    mono: true,
  },
  {
    id: 'sni',
    get header() {
      return t('column.sni');
    },
    accessor: (item) => snisOf(item.value),
    cell: (item) => {
      const snis = snisOf(item.value);
      return snis.length > 0 ? <Lines lines={snis} mono /> : <Empty />;
    },
    defaultVisible: true,
    width: 150,
    mono: true,
  },
  {
    id: 'remote_addr',
    get header() {
      return t('column.remote_addr');
    },
    accessor: (item) => str(item.value.remote_addr),
    defaultVisible: true,
    width: 126,
    mono: true,
  },
  {
    id: 'upstream',
    get header() {
      return t('column.upstream');
    },
    accessor: (item, ctx) => {
      const summary = upstreamSummary(item.value, ctx);
      if (summary.source === 'none') return undefined;
      return summary.source === 'missing' ? t('cell.missing.upstreams', { id: summary.refId ?? '' }) : summary.label;
    },
    cell: (item, ctx) => <UpstreamCell summary={upstreamSummary(item.value, ctx)} />,
    defaultVisible: true,
    width: 120,
  },
  {
    id: 'plugins',
    get header() {
      return t('column.plugins');
    },
    // The route's own, then the service's it doesn't override (merge_service_stream_route, apisix/plugin.lua).
    accessor: (item, ctx) => effectivePlugins(item.value, ctx).map((p) => p.name),
    cell: (item, ctx) => <PluginChips plugins={pluginChips(item.value, ctx)} />,
    defaultVisible: true,
    width: 110,
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
    id: 'service',
    get header() {
      return t('column.service');
    },
    accessor: (item, ctx) => refName('services', item.value.service_id, ctx),
    cell: (item, ctx) => <RefCell kind="services" target={resolveRef('services', item.value.service_id, ctx)} />,
    defaultVisible: false,
    width: 130,
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
