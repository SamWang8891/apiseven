// The SSL list's columns. Accessors return plain values for sorting (strings, numbers, string
// arrays); cells present them. What a certificate is used for follows APISIX (usage.ts); its details
// come from our certificate reader, and read `—` where it can't read one (a reference, or a form it
// doesn't know).
import type { Item } from '../../api/types';
import { t } from '../../i18n';
import { Empty } from '../../table/cells';
import { IdCell, LabelChips, TimeCell } from '../cells';
import { ExpiryBadge } from '../expiry';
import type { ColumnDef } from '../registry';
import { labelPairs, sslNotAfter } from '../resolve';
import { NameText, SnisCell, UsageCell } from './cells';
import { certOf, shortName, sniNames, typeOf, usageCount } from './usage';

const time = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

const typeLabel = (item: Item): string => t(`ssl.type.${typeOf(item.value)}`);
const hasMtls = (item: Item): boolean => item.value.client !== undefined;

// Headers are getters, so they follow the language table at use (never spread a column). The
// default columns' widths add up, with the status (126), checkbox (34) and actions (40) columns, to
// the 1010px a 1280px window leaves beside the sidebar.
export const sslColumns: ColumnDef[] = [
  {
    id: 'snis',
    get header() {
      return t('column.snis');
    },
    accessor: (item) => sniNames(item.value),
    cell: (item) => <SnisCell item={item} />,
    defaultVisible: true,
    width: 230,
  },
  {
    id: 'expires',
    get header() {
      return t('column.expires');
    },
    accessor: (item) => sslNotAfter(item.value),
    cell: (item) => <ExpiryBadge notAfter={sslNotAfter(item.value)} />,
    defaultVisible: true,
    width: 150,
  },
  {
    id: 'issuer',
    get header() {
      return t('column.issuer');
    },
    accessor: (item) => shortName(certOf(item.value)?.issuer),
    cell: (item) => {
      const issuer = certOf(item.value)?.issuer;
      return issuer === undefined ? <Empty /> : <span className="tbl-line" title={issuer}>{shortName(issuer)}</span>;
    },
    defaultVisible: true,
    width: 150,
  },
  {
    id: 'type',
    get header() {
      return t('column.type');
    },
    accessor: typeLabel,
    defaultVisible: true,
    width: 80,
  },
  {
    id: 'used_by',
    get header() {
      return t('column.used_by');
    },
    accessor: (item, ctx) => usageCount(item, ctx),
    cell: (item, ctx) => <UsageCell item={item} ctx={ctx} />,
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
    id: 'subject',
    get header() {
      return t('column.subject');
    },
    accessor: (item) => certOf(item.value)?.subject,
    cell: (item) => <NameText text={certOf(item.value)?.subject} />,
    defaultVisible: false,
    width: 200,
  },
  {
    id: 'not_before',
    get header() {
      return t('column.not_before');
    },
    accessor: (item) => certOf(item.value)?.notBefore,
    cell: (item) => {
      const from = certOf(item.value)?.notBefore;
      return from === undefined ? <Empty /> : <TimeCell epoch={from / 1000} />;
    },
    defaultVisible: false,
    width: 100,
  },
  {
    id: 'serial',
    get header() {
      return t('column.serial');
    },
    accessor: (item) => certOf(item.value)?.serial,
    cell: (item) => <NameText text={certOf(item.value)?.serial} mono />,
    defaultVisible: false,
    width: 160,
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
    id: 'mtls',
    get header() {
      return t('column.mtls');
    },
    accessor: (item) => (hasMtls(item) ? t('ui.yes') : t('ui.no')),
    defaultVisible: false,
    width: 80,
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
