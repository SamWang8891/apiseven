// The protos list columns: what a proto is, how big its definition is, and what uses it.
import type { Item } from '../../api/types';
import { t } from '../../i18n';
import { IdCell, LabelChips, NameDescCell, UsedByCell } from '../cells';
import type { Ctx } from '../ctx';
import type { ColumnDef } from '../registry';
import { labelPairs, nameOfValue, referencesTo } from '../resolve';
import { timeColumns } from '../timeColumns';
import { contentBytes, formatBytes, isDescriptorSet } from './content';

/**
 * The objects whose grpc-transcode names the proto (referencesTo): routes and services, which
 * APISIX's delete check looks at (admin/proto.lua 61–101), and plugin configs, consumers and consumer
 * groups, which it does not, though they use it as well. Undefined until every one of those lists has
 * loaded, so "unused" is never said of a proto APISIX would refuse to delete.
 */
export function protoUsers(item: Item, ctx: Ctx) {
  const { routes, services, pluginConfigs, consumers, consumerGroups } = ctx.loaded;
  return routes && services && pluginConfigs && consumers && consumerGroups ? referencesTo('protos', item.id, ctx) : undefined;
}

/** The content's size in bytes (UTF-8, as stored); undefined without content. */
export const protoSize = (item: Item): number | undefined => (typeof item.value.content === 'string' ? contentBytes(item.value.content) : undefined);

export const protoColumns: ColumnDef[] = [
  {
    id: 'name',
    get header() {
      return t('column.name');
    },
    accessor: (item) => nameOfValue(item.value) ?? item.id,
    cell: (item) => <NameDescCell kind="protos" item={item} />,
    defaultVisible: true,
    width: 220,
  },
  {
    id: 'id',
    get header() {
      return t('column.id');
    },
    accessor: (item) => item.id,
    cell: (item) => <IdCell id={item.id} />,
    defaultVisible: true,
    width: 200,
    mono: true,
  },
  {
    id: 'size',
    get header() {
      return t('column.size');
    },
    accessor: protoSize,
    cell: (item) => {
      const size = protoSize(item);
      if (size === undefined) return undefined;
      return (
        <span className="tbl-line cell-count" title={`${size} B`}>
          {isDescriptorSet(item.value.content) ? `${formatBytes(size)} · ${t('pr.content.binary')}` : formatBytes(size)}
        </span>
      );
    },
    defaultVisible: true,
    width: 120,
  },
  {
    id: 'used_by',
    get header() {
      return t('column.used_by');
    },
    accessor: (item, ctx) => protoUsers(item, ctx)?.length,
    cell: (item, ctx) => {
      const users = protoUsers(item, ctx);
      return users ? <UsedByCell refs={users} /> : <span className="cell-muted">{t('picker.loading')}</span>;
    },
    defaultVisible: true,
    width: 88,
  },
  ...timeColumns(),
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
