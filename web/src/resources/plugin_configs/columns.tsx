// The plugin configs list columns: what a plugin config is, its plugins (a switched-off one marked
// `off`: plugin.filter skips it, plugin.lua 595–597) and the routes that name it.
import type { Item } from '../../api/types';
import { t } from '../../i18n';
import { IdCell, LabelChips, NameDescCell, PluginChips, UsedByCell } from '../cells';
import type { Ctx } from '../ctx';
import type { ColumnDef } from '../registry';
import { labelPairs, nameOfValue, referenceUse } from '../resolve';
import { servicePlugins } from '../services/columns';
import { timeColumns } from '../timeColumns';

/** The routes that name the plugin config (what APISIX's delete check looks at, admin/plugin_config.lua 47–62); undefined until they have loaded. */
export function routesOf(item: Item, ctx: Ctx) {
  const use = referenceUse('plugin_configs', item.id, ctx);
  return 'refs' in use ? use.refs : undefined;
}

export const pluginConfigColumns: ColumnDef[] = [
  {
    id: 'name',
    get header() {
      return t('column.name');
    },
    accessor: (item) => nameOfValue(item.value) ?? item.id,
    cell: (item) => <NameDescCell kind="plugin_configs" item={item} />,
    defaultVisible: true,
    width: 220,
  },
  {
    id: 'plugins',
    get header() {
      return t('column.plugins');
    },
    accessor: (item) => servicePlugins(item.value).map((p) => p.name),
    cell: (item) => <PluginChips plugins={servicePlugins(item.value)} />,
    defaultVisible: true,
    width: 300,
  },
  {
    id: 'used_by',
    get header() {
      return t('column.used_by');
    },
    accessor: (item, ctx) => routesOf(item, ctx)?.length,
    cell: (item, ctx) => {
      const users = routesOf(item, ctx);
      return users ? <UsedByCell refs={users} /> : <span className="cell-muted">{t('picker.loading')}</span>;
    },
    defaultVisible: true,
    width: 88,
  },
  ...timeColumns(),
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
];
