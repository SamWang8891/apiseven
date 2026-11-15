// The plugin metadata list's columns (rows.ts): the plugin, whether anything is stored for it, and a
// one-line summary of what is, its secrets masked (redactObject: the metadata schema's encrypt_fields,
// or every value while the plugin's schema isn't known). Plugin metadata has no timestamps: APISIX
// stamps none on it (admin/resource.lua 315–322 skips inject_conf_with_prev_conf for it).
import type { Item } from '../../api/types';
import { t } from '../../i18n';
import { NameCell } from '../../table/cells';
import type { ColumnDef } from '../registry';
import { StateCell, SummaryCell } from './cells';
import { stateLabel, type MetadataRow } from './rows';

const row = (item: Item): MetadataRow => item as MetadataRow;

export const metadataColumns: ColumnDef[] = [
  {
    id: 'plugin',
    get header() {
      return t('column.plugin');
    },
    accessor: (item) => item.id,
    cell: (item) => <NameCell kind="plugin_metadata" item={item} value={item.id} mono />,
    defaultVisible: true,
    width: 240,
    mono: true,
  },
  {
    id: 'state',
    get header() {
      return t('column.state');
    },
    accessor: stateLabel,
    cell: (item) => <StateCell item={row(item)} />,
    defaultVisible: true,
    width: 240,
  },
  {
    id: 'settings',
    get header() {
      return t('column.settings');
    },
    accessor: () => undefined,
    cell: (item) => <SummaryCell item={row(item)} />,
    defaultVisible: true,
    width: 480,
    sortable: false,
  },
];
