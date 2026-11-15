// The time columns every kind with timestamps shares: when it changed (shown) and when it was created
// (on demand), sorted as numbers.
import type { Item } from '../api/types';
import { t } from '../i18n';
import { TimeCell } from './cells';
import type { ColumnDef } from './registry';

const time = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/** Fresh columns on every call (their headers are getters: never spread one). */
export function timeColumns(): ColumnDef[] {
  return [
    {
      id: 'updated',
      get header() {
        return t('column.updated');
      },
      accessor: (item: Item) => time(item.value.update_time),
      cell: (item: Item) => <TimeCell epoch={item.value.update_time} />,
      defaultVisible: true,
      width: 88,
    },
    {
      id: 'created',
      get header() {
        return t('column.created');
      },
      accessor: (item: Item) => time(item.value.create_time),
      cell: (item: Item) => <TimeCell epoch={item.value.create_time} />,
      defaultVisible: false,
      width: 88,
    },
  ];
}
