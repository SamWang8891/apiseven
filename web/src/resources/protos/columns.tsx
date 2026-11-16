// The protos list columns: what a proto is, how big its definition is, and what uses it.
import type { Item, Kind } from '../../api/types';
import { t } from '../../i18n';
import { IdCell, LabelChips, NameDescCell, UsedByCell } from '../cells';
import type { Ctx } from '../ctx';
import type { ColumnDef } from '../registry';
import { labelPairs, nameOfValue, referenceUse, type Reference, type ReferenceUse } from '../resolve';
import { timeColumns } from '../timeColumns';
import { contentBytes, formatBytes, isDescriptorSet } from './content';

/**
 * What uses the proto: the objects whose grpc-transcode names it (referencesTo), once every list they
 * come from has loaded: routes and services, which APISIX's delete check looks at (admin/proto.lua
 * 61–101), and plugin configs, consumers, consumer groups and global rules, which it does not, though
 * they use it as well (deleting the proto breaks them). So "unused" means none of them names it.
 * `loading` until then; `failed` (with the lists' kinds) when one of them could not be read.
 */
export type ProtoUse = ReferenceUse;

/** The lists are resolve.ts's one table (referenceUse): routes, services, plugin configs, consumers, consumer groups, global rules. */
export const protoUse = (id: string, ctx: Ctx): ProtoUse => referenceUse('protos', id, ctx);

/** The users once known; undefined while loading or when a list failed. */
export function protoUsers(id: string, ctx: Ctx): Reference[] | undefined {
  const use = protoUse(id, ctx);
  return 'refs' in use ? use.refs : undefined;
}

/** The kinds' names, for "{lists} didn't load". */
export const listNames = (kinds: Kind[]): string => kinds.map((kind) => t(`kind.${kind}.plural`)).join(', ');

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
    accessor: (item, ctx) => protoUsers(item.id, ctx)?.length,
    cell: (item, ctx) => {
      const use = protoUse(item.id, ctx);
      if ('refs' in use) return <UsedByCell refs={use.refs} />;
      if ('failed' in use) return <span className="cell-muted">{t('pr.usedBy.failed', { lists: listNames(use.failed) })}</span>;
      return <span className="cell-muted">{t('picker.loading')}</span>;
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
