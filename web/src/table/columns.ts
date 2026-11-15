import { createElement } from 'react';
import type { Kind } from '../api/types';
import { t } from '../i18n';
import type { ColumnDef } from '../resources/registry';
import { isEnabled } from '../resources/resolve';
import { StatusBadge, StatusCell } from './StatusCell';

/** Width of a column that names none and that the user has not resized. */
export const DEFAULT_WIDTH = 160;
const NAME_WIDTH = 220;

export function widthOf(column: ColumnDef, widths: Record<string, number>): number {
  return widths[column.id] ?? column.width ?? (column.id === 'name' ? NAME_WIDTH : DEFAULT_WIDTH);
}

function statusColumn(kind: Kind, editable: boolean): ColumnDef {
  return {
    id: 'status',
    get header() {
      return t('table.status');
    },
    // 1 enabled, 0 disabled: sortable, and what the status filter of a kind can match on.
    accessor: (item) => (isEnabled(item.value) ? 1 : 0),
    cell: (item) => (editable ? createElement(StatusCell, { kind, item }) : createElement(StatusBadge, { item })),
    defaultVisible: true,
    // A switch and "Disabled" with the cell padding.
    width: 126,
  };
}

/**
 * The columns with the built-in status first, for kinds with a status (unless they define `status`):
 * a switch that writes at once when `editable`, else the state in words only.
 */
export function withStatusColumn(kind: Kind, hasStatus: boolean, columns: ColumnDef[], editable = true): ColumnDef[] {
  if (!hasStatus || columns.some((c) => c.id === 'status')) return columns;
  return [statusColumn(kind, editable), ...columns];
}
