// The columns of a consumer's credentials table (the consumer editor's Credentials tab). A
// credential's plugin is listed by name only: its config is the key. The `name` column has no cell
// of its own, so the table renders it as the link to the credential (it needs the consumer).
import { t } from '../../i18n';
import { IdCell, LabelChips, TimeCell } from '../cells';
import type { ColumnDef } from '../registry';
import { labelPairs, nameOfValue } from '../resolve';
import { ScopedPluginChips } from '../ScopedPluginChips';
import { servicePlugins as ownPlugins } from '../services/columns';

const time = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

export const credentialColumns: ColumnDef[] = [
  {
    id: 'id',
    get header() {
      return t('column.id');
    },
    accessor: (item) => item.id,
    cell: (item) => <IdCell id={item.id} />,
    defaultVisible: true,
    width: 180,
    mono: true,
  },
  {
    id: 'name',
    get header() {
      return t('column.name');
    },
    accessor: (item) => nameOfValue(item.value) ?? item.id,
    defaultVisible: true,
    width: 200,
  },
  {
    id: 'plugin',
    get header() {
      return t('column.plugin');
    },
    accessor: (item) => ownPlugins(item.value).map((p) => p.name),
    // An auth plugin stored as off still signs in (plugins/auth.ts): never "off" there.
    cell: (item) => <ScopedPluginChips value={item.value} owner="credential" />,
    defaultVisible: true,
    width: 160,
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
