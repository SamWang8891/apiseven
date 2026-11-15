import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { t } from '../i18n';
import type { ColumnDef } from '../resources/registry';
import { MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH } from './tableState';

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

/** Pixels an arrow key moves the edge; with Shift, `BIG_STEP`. */
const STEP = 10;
const BIG_STEP = 50;

/**
 * A sortable header (click; shift-click adds a rule) with a resizable right edge: drag it, or focus it
 * (a vertical separator in the tab order) and press Left / Right (Shift for bigger steps); double-click
 * or Enter puts the default width back. A column with `sortable: false` has a plain label instead of
 * the sort button.
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

  function keyResize(e: ReactKeyboardEvent<HTMLSpanElement>) {
    const step = e.shiftKey ? BIG_STEP : STEP;
    const by = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    if (by !== 0) {
      e.preventDefault();
      const next = Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, width + by));
      if (next !== width) onResize(next);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onResetWidth();
    }
  }

  const sortable = column.sortable !== false;
  return (
    // Named by its header alone: the resize edge inside has a name of its own ("Resize Hosts").
    <th
      scope="col"
      className={sorted ? 'tbl-th tbl-th--sorted' : 'tbl-th'}
      aria-label={column.header}
      aria-sort={sortable ? (sorted ? (desc ? 'descending' : 'ascending') : 'none') : undefined}
    >
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
        role="separator"
        aria-orientation="vertical"
        aria-label={t('table.resizeLabel', { column: column.header })}
        aria-valuenow={width}
        aria-valuemin={MIN_COLUMN_WIDTH}
        aria-valuemax={MAX_COLUMN_WIDTH}
        aria-valuetext={t('table.resizeValue', { width })}
        tabIndex={0}
        title={t('table.resize', { column: column.header })}
        onPointerDown={startResize}
        onDoubleClick={onResetWidth}
        onKeyDown={keyResize}
      />
    </th>
  );
}
