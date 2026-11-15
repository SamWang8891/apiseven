// The consumer groups list columns: what a group is, its plugins, and how many consumers are in it.
import type { Item } from '../../api/types';
import { t } from '../../i18n';
import { IdCell, LabelChips, NameDescCell, PluginChips, TimeCell } from '../cells';
import type { Ctx } from '../ctx';
import type { ColumnDef } from '../registry';
import { labelPairs, nameOfValue } from '../resolve';
import { servicePlugins as ownPlugins } from '../services/columns';

const time = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const idOf = (v: unknown): string | undefined => (typeof v === 'number' ? String(v) : typeof v === 'string' && v !== '' ? v : undefined);

/** The consumers whose group_id is the group's id (a number counts as its text); undefined until the consumers have loaded. */
export function membersOf(groupId: string, ctx: Ctx): Item[] | undefined {
  return ctx.loaded.consumers ? ctx.consumers.filter((c) => idOf(c.value.group_id) === groupId) : undefined;
}

export const consumerGroupColumns: ColumnDef[] = [
  {
    id: 'id',
    get header() {
      return t('column.id');
    },
    accessor: (item) => item.id,
    cell: (item) => <IdCell id={item.id} />,
    defaultVisible: true,
    width: 160,
    mono: true,
  },
  {
    id: 'name',
    get header() {
      return t('column.name');
    },
    accessor: (item) => nameOfValue(item.value) ?? item.id,
    cell: (item) => <NameDescCell kind="consumer_groups" item={item} />,
    defaultVisible: true,
    width: 220,
  },
  {
    id: 'plugins',
    get header() {
      return t('column.plugins');
    },
    accessor: (item) => ownPlugins(item.value).map((p) => p.name),
    cell: (item) => <PluginChips plugins={ownPlugins(item.value)} />,
    defaultVisible: true,
    width: 220,
  },
  {
    id: 'consumers',
    get header() {
      return t('column.consumers');
    },
    accessor: (item, ctx) => membersOf(item.id, ctx)?.length,
    cell: (item, ctx) => {
      const members = membersOf(item.id, ctx);
      return members ? <span className="tbl-line cell-count">{members.length}</span> : <span className="cell-muted">{t('picker.loading')}</span>;
    },
    defaultVisible: true,
    width: 104,
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
