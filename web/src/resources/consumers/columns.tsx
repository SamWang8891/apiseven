// The consumers list columns. A consumer's id is its username. Its plugins are listed by name only:
// their configs hold its keys. How many credentials it has is fetched per row as the row is shown
// (CredentialCount), so that column cannot sort.
import type { Item } from '../../api/types';
import { t } from '../../i18n';
import { LabelChips, NameDescCell, PluginChips, RefCell, TimeCell } from '../cells';
import type { Ctx } from '../ctx';
import type { ColumnDef } from '../registry';
import { labelPairs, nameOfValue, resolveRef } from '../resolve';
import { servicePlugins as ownPlugins } from '../services/columns';
import { CredentialCount } from './CredentialCount';

const time = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/** The consumer's group by name (its id when it has none, or while it is not found). */
export function groupName(item: Item, ctx: Ctx): string | undefined {
  const target = resolveRef('consumer_groups', item.value.group_id, ctx);
  return target && (target.item ? (nameOfValue(target.item.value) ?? target.id) : target.id);
}

// Headers are getters, so they follow the language table at use (never spread a column). The
// default columns, with the checkbox (34) and actions (40) columns, fit the 1010px a 1280px window
// leaves beside the sidebar.
export const consumerColumns: ColumnDef[] = [
  {
    id: 'username',
    get header() {
      return t('column.username');
    },
    accessor: (item) => item.id,
    cell: (item) => <NameDescCell kind="consumers" item={item} mono />,
    defaultVisible: true,
    width: 210,
  },
  {
    id: 'group',
    get header() {
      return t('column.group');
    },
    accessor: groupName,
    cell: (item, ctx) => <RefCell kind="consumer_groups" target={resolveRef('consumer_groups', item.value.group_id, ctx)} loading={!ctx.loaded.consumerGroups} />,
    defaultVisible: true,
    width: 160,
  },
  {
    id: 'plugins',
    get header() {
      return t('column.plugins');
    },
    accessor: (item) => ownPlugins(item.value).map((p) => p.name),
    cell: (item) => <PluginChips plugins={ownPlugins(item.value)} />,
    defaultVisible: true,
    width: 210,
  },
  {
    id: 'credentials',
    get header() {
      return t('column.credentials');
    },
    accessor: () => undefined,
    cell: (item) => <CredentialCount username={item.id} />,
    defaultVisible: true,
    width: 104,
    sortable: false,
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
