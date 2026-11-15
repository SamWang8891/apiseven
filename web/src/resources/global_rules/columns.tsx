// The global rules list columns: the rule's id, its plugins (a switched-off one marked `off`: APISIX
// skips it, plugin.lua 595–597) and when it changed.
import { t } from '../../i18n';
import { NameCell } from '../../table/cells';
import { PluginChips } from '../cells';
import type { ColumnDef } from '../registry';
import { servicePlugins } from '../services/columns';
import { timeColumns } from '../timeColumns';

export const globalRuleColumns: ColumnDef[] = [
  {
    id: 'id',
    get header() {
      return t('column.id');
    },
    accessor: (item) => item.id,
    cell: (item) => <NameCell kind="global_rules" item={item} value={item.id} mono />,
    defaultVisible: true,
    width: 220,
    mono: true,
  },
  {
    id: 'plugins',
    get header() {
      return t('column.plugins');
    },
    accessor: (item) => servicePlugins(item.value).map((p) => p.name),
    cell: (item) => <PluginChips plugins={servicePlugins(item.value)} />,
    defaultVisible: true,
    width: 420,
  },
  ...timeColumns(),
];
