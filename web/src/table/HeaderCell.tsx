import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { t } from '../i18n';
import type { ColumnDef } from '../resources/registry';
import { MIN_COLUMN_WIDTH } from './tableState';

export interface HeaderCellProps {
  column: ColumnDef;
  width: number;
  /** This column's place in the sort (0 = primary), or -1. */
  sortIndex: number;
  desc: boolean;
  /** More than one sort rule: show the priority numbers. */
  multiSort: boolean;
  onSort: (multi: boolean) => void;
  /** While dragging the edge (no re-render), and once released. */
  onResizing: (width: number) => void;
  onResize: (width: number) => void;
  onResetWidth: () => void;
}

/**
 * A sortable header (click; shift-click adds a rule) with a draggable right edge (double-click resets);
 * a column with `sortable: false` has a plain label instead of the sort button.
 */
export function HeaderCell({ column, width, sortIndex, desc, multiSort, onSort, onResizing, onResize, onResetWidth }: HeaderCellProps) {
  const sorted = sortIndex >= 0;
  const Arrow = !sorted ? ArrowUpDown : desc ? ArrowDown : ArrowUp;

  function startResize(e: ReactPointerEvent<HTMLSpanElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    const startX = e.clientX;
    let current = width;
    handle.setPointerCapture?.(e.pointerId);
    const move = (ev: PointerEvent) => {
      current = Math.max(MIN_COLUMN_WIDTH, Math.round(width + ev.clientX - startX));
      onResizing(current);
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      if (current !== width) onResize(current);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  const sortable = column.sortable !== false;
  return (
    <th scope="col" className={sorted ? 'tbl-th tbl-th--sorted' : 'tbl-th'} aria-sort={sortable ? (sorted ? (desc ? 'descending' : 'ascending') : 'none') : undefined}>
      {sortable ? (
        <button type="button" className="tbl-sort" onClick={(e) => onSort(e.shiftKey)}>
          <span className="tbl-sort__label">{column.header}</span>
          <span className="tbl-sort__mark" aria-hidden="true">
            <Arrow size={13} strokeWidth={2.25} />
            {sorted && multiSort && <span className="tbl-sort__rank">{sortIndex + 1}</span>}
          </span>
          {sorted && multiSort && <span className="ui-sr-only">{t('table.sort.priority', { n: sortIndex + 1 })}</span>}
        </button>
      ) : (
        <span className="tbl-sort tbl-sort--off">
          <span className="tbl-sort__label">{column.header}</span>
        </span>
      )}
      <span
        className="tbl-resize"
        aria-hidden="true"
        title={t('table.resize', { column: column.header })}
        onPointerDown={startResize}
        onDoubleClick={onResetWidth}
      />
    </th>
  );
}
