import { Ellipsis } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import type { Item } from '../api/types';
import { t } from '../i18n';
import { registry, type ColumnDef } from '../resources/registry';
import { Button, Menu } from '../ui';
import { DefaultCell, NameCell, SelectBox } from './cells';
import { widthOf } from './columns';
import type { DataTableProps } from './DataTable';
import { HeaderCell } from './HeaderCell';
import type { TableRow } from './rows';
import type { SortRule } from './sort';

const CHECK_WIDTH = 40;
const ACTIONS_WIDTH = 48;
const SKELETON_ROWS = 8;

export interface GridProps extends Pick<DataTableProps, 'kind' | 'ctx' | 'parent' | 'rowActions' | 'groupHeader' | 'ungroupedLabel'> {
  /** The visible columns, in order. */
  columns: ColumnDef[];
  widths: Record<string, number>;
  sort: SortRule[];
  /** undefined while loading: skeleton rows. */
  rows: TableRow[] | undefined;
  selectable: boolean;
  selected: ReadonlySet<string>;
  allSelected: boolean | 'indeterminate';
  matchCount: number;
  onSelect: (id: string, on: boolean) => void;
  onSelectAll: (on: boolean) => void;
  onSort: (id: string, multi: boolean) => void;
  onResize: (id: string, width: number) => void;
  onResetWidth: (id: string) => void;
}

/** The <table>: sticky header, checkbox column on the left, actions on the right, a filler between. */
export function Grid(props: GridProps) {
  const { kind, columns, widths, sort, rows, selectable, selected, ctx, parent } = props;
  const tableRef = useRef<HTMLTableElement>(null);
  const cols = useRef(new Map<string, HTMLTableColElement>());
  const tableWidth = (selectable ? CHECK_WIDTH : 0) + columns.reduce((sum, c) => sum + widthOf(c, widths), 0) + ACTIONS_WIDTH;
  const span = columns.length + (selectable ? 1 : 0) + 2;
  const nameOf = (item: Item) => registry[kind].nameOf(item);
  const loadingLabel = t('table.loading', { plural: registry[kind].plural });

  // Live resizing changes the DOM directly; the width is saved (and re-rendered) on release.
  function resizing(id: string, width: number) {
    const col = cols.current.get(id);
    const table = tableRef.current;
    if (!col || !table) return;
    const delta = width - parseFloat(col.style.width);
    col.style.width = `${width}px`;
    table.style.width = `${parseFloat(table.style.width) + delta}px`;
  }

  function cell(column: ColumnDef, item: Item): ReactNode {
    if (column.cell) return column.cell(item, ctx);
    const value = column.accessor(item, ctx);
    if (column.id === 'name') return <NameCell kind={kind} item={item} value={value} parent={parent} />;
    return <DefaultCell value={value} mono={column.mono} />;
  }

  function itemRow(row: Extract<TableRow, { type: 'item' }>) {
    const { item } = row;
    const isSelected = selected.has(item.id);
    const actions = props.rowActions(item);
    return (
      <tr key={row.key} className={isSelected ? 'tbl-row tbl-row--selected' : 'tbl-row'}>
        {selectable && (
          <td className="tbl-cell-check">
            <SelectBox checked={isSelected} onChange={(on) => props.onSelect(item.id, on)} label={t('table.selectRow', { name: nameOf(item) })} />
          </td>
        )}
        {columns.map((column) => (
          <td key={column.id} className={column.mono ? 'tbl-cell mono' : 'tbl-cell'}>
            {cell(column, item)}
          </td>
        ))}
        <td className="tbl-filler" aria-hidden="true" />
        <td className="tbl-cell-actions">
          {actions.length > 0 && (
            <Menu
              trigger={<Button variant="ghost" size="sm" icon={<Ellipsis size={16} />} aria-label={t('table.actionsFor', { name: nameOf(item) })} />}
              items={actions}
            />
          )}
        </td>
      </tr>
    );
  }

  function groupRow(row: Extract<TableRow, { type: 'group' }>) {
    const content =
      row.group !== null && props.groupHeader ? (
        props.groupHeader(row.group, row.items)
      ) : (
        <>
          <span className="tbl-group__name">{row.group ?? props.ungroupedLabel ?? t('table.ungrouped')}</span>
          <span className="tbl-group__count">{row.items.length}</span>
        </>
      );
    return (
      <tr key={row.key} className="tbl-group">
        <th scope="rowgroup" role="rowheader" colSpan={span}>
          <div className="tbl-group__inner">{content}</div>
        </th>
      </tr>
    );
  }

  // Each group (with its header) is a <tbody> of its own.
  const bodies: TableRow[][] = [];
  for (const row of rows ?? []) {
    if (row.type === 'group' || bodies.length === 0) bodies.push([]);
    bodies.at(-1)?.push(row);
  }

  return (
    <>
      <table ref={tableRef} className="tbl-table" style={{ width: tableWidth }}>
        <colgroup>
          {selectable && <col style={{ width: CHECK_WIDTH }} />}
          {columns.map((column) => (
            <col
              key={column.id}
              ref={(el) => {
                if (el) cols.current.set(column.id, el);
                else cols.current.delete(column.id);
              }}
              style={{ width: widthOf(column, widths) }}
            />
          ))}
          <col />
          <col style={{ width: ACTIONS_WIDTH }} />
        </colgroup>
        <thead>
          <tr>
            {selectable && (
              <th scope="col" className="tbl-cell-check">
                <SelectBox
                  checked={props.allSelected}
                  onChange={props.onSelectAll}
                  disabled={!rows}
                  label={t('table.selectAll', { count: props.matchCount })}
                />
              </th>
            )}
            {columns.map((column) => {
              const sortIndex = sort.findIndex((rule) => rule.id === column.id);
              return (
                <HeaderCell
                  key={column.id}
                  column={column}
                  width={widthOf(column, widths)}
                  sortIndex={sortIndex}
                  desc={sort[sortIndex]?.desc ?? false}
                  multiSort={sort.length > 1}
                  onSort={(multi) => props.onSort(column.id, multi)}
                  onResizing={(width) => resizing(column.id, width)}
                  onResize={(width) => props.onResize(column.id, width)}
                  onResetWidth={() => props.onResetWidth(column.id)}
                />
              );
            })}
            <td className="tbl-filler" aria-hidden="true" />
            <th scope="col" className="tbl-cell-actions">
              <span className="ui-sr-only">{t('table.actions')}</span>
            </th>
          </tr>
        </thead>
        {rows ? (
          bodies.map((body, i) => (
            <tbody key={body[0]?.key ?? i}>
              {body.map((row) => (row.type === 'group' ? groupRow(row) : itemRow(row)))}
            </tbody>
          ))
        ) : (
          <tbody aria-hidden="true">
            {Array.from({ length: SKELETON_ROWS }, (_, i) => (
              <tr key={i} className="tbl-row">
                {selectable && <td className="tbl-cell-check" />}
                {columns.map((column) => (
                  <td key={column.id} className="tbl-cell">
                    <span className="tbl-skeleton" style={{ width: `${45 + ((i * 7 + column.id.length * 13) % 45)}%` }} />
                  </td>
                ))}
                <td className="tbl-filler" />
                <td className="tbl-cell-actions" />
              </tr>
            ))}
          </tbody>
        )}
      </table>
      {!rows && (
        <p className="ui-sr-only" role="status" aria-label={loadingLabel}>
          {loadingLabel}
        </p>
      )}
    </>
  );
}
