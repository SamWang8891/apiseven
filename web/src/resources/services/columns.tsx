// The services list columns. Accessors return plain values for sorting (strings, numbers, string
// arrays); cells present them (../cells.tsx). A service has no status, so there is no status column.
import { isObj } from '../../api/sanitize';
import type { Item, Obj } from '../../api/types';
import { t } from '../../i18n';
import { HostsCell, IdCell, LabelChips, NameDescCell, PluginChips, TimeCell, UpstreamCell, UsedByCell, type PluginChip } from '../cells';
import type { Ctx } from '../ctx';
import type { ColumnDef } from '../registry';
import { entryEffect } from '../../plugins/entryEffect';
import { labelPairs, nameOfValue, referencesTo, upstreamSummary } from '../resolve';

const time = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v !== '') : [];
}

/**
 * The service's own plugins, by name, each saying whether it is off (`_meta.disable`), or that it has
 * no effect here (a plugin APISIX runs for the whole instance: entryEffect), which is never "off".
 */
export function servicePlugins(service: Obj): PluginChip[] {
  if (!isObj(service.plugins)) return [];
  return Object.entries(service.plugins)
    .map(([name, conf]): PluginChip => {
      const effect = entryEffect(name, conf);
      return effect === 'noEffect' ? { name, noEffect: true } : { name, disabled: effect === 'off' };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The routes and stream routes that use the service (referencesTo); undefined until both lists have
 * loaded (with stream mode off, the stream routes count as loaded: there are none).
 */
export function usersOf(item: Item, ctx: Ctx) {
  return ctx.loaded.routes && ctx.loaded.streamRoutes ? referencesTo('services', item.id, ctx) : undefined;
}

// Headers are getters, so they follow the language table at use (never spread a column). The
// default columns, with the checkbox (34) and actions (40) columns, fit the 1010px a 1280px window
// leaves beside the sidebar.
export const serviceColumns: ColumnDef[] = [
  {
    id: 'name',
    get header() {
      return t('column.name');
    },
    accessor: (item) => nameOfValue(item.value) ?? item.id,
    cell: (item) => <NameDescCell kind="services" item={item} />,
    defaultVisible: true,
    width: 200,
  },
  {
    id: 'hosts',
    get header() {
      return t('column.hosts');
    },
    accessor: (item) => strings(item.value.hosts),
    cell: (item) => <HostsCell hosts={strings(item.value.hosts)} />,
    defaultVisible: true,
    width: 190,
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
    width: 170,
  },
  {
    id: 'plugins',
    get header() {
      return t('column.plugins');
    },
    accessor: (item) => servicePlugins(item.value).map((p) => p.name),
    cell: (item) => <PluginChips plugins={servicePlugins(item.value)} />,
    defaultVisible: true,
    width: 170,
  },
  {
    id: 'routes',
    get header() {
      return t('column.routes');
    },
    accessor: (item, ctx) => usersOf(item, ctx)?.length,
    cell: (item, ctx) => {
      const users = usersOf(item, ctx);
      return users ? <UsedByCell refs={users} /> : <span className="cell-muted">{t('picker.loading')}</span>;
    },
    defaultVisible: true,
    width: 80,
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
    id: 'websocket',
    get header() {
      return t('column.websocket');
    },
    accessor: (item) => item.value.enable_websocket === true,
    defaultVisible: false,
    width: 110,
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
