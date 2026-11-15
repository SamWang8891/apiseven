import { Columns3, GripVertical, RotateCcw } from 'lucide-react';
import { Popover } from 'radix-ui';
import { useEffect, useId, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { t } from '../i18n';
import type { ColumnDef } from '../resources/registry';
import { Button, escapeFallback } from '../ui';
import { SelectBox } from './cells';

export interface ColumnsMenuProps {
  /** Every column, keyed by id. */
  columns: ColumnDef[];
  order: string[];
  visible: string[];
  onChange: (next: { order: string[]; visible: string[] }) => void;
  onReset: () => void;
}

function move(order: string[], id: string, to: number): string[] {
  const rest = order.filter((x) => x !== id);
  const at = Math.max(0, Math.min(to, rest.length));
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

/**
 * Show, hide and reorder columns: a checkbox per column, dragged by its row, or moved with
 * Alt+↑ / Alt+↓ while its checkbox has focus. The last visible column can't be hidden.
 */
export function ColumnsMenu({ columns, order, visible, onChange, onReset }: ColumnsMenuProps) {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const byId = new Map(columns.map((c) => [c.id, c]));
  const shown = new Set(visible);
  const boxes = useRef(new Map<string, HTMLButtonElement>());
  const [dragging, setDragging] = useState<string>();
  const [over, setOver] = useState<string>();
  const focusAfterMove = useRef<string>(undefined);
  const [announcement, setAnnouncement] = useState('');

  // Moving an item in the DOM can drop its focus; put it back on the moved column once rendered.
  useEffect(() => {
    const id = focusAfterMove.current;
    if (id === undefined) return;
    focusAfterMove.current = undefined;
    boxes.current.get(id)?.focus();
  });

  function reorder(id: string, to: number) {
    const next = move(order, id, to);
    if (next.join('\u0000') === order.join('\u0000')) return;
    onChange({ order: next, visible });
    setAnnouncement(t('table.columns.moved', { column: byId.get(id)?.header ?? id, position: next.indexOf(id) + 1, count: next.length }));
  }

  function toggle(id: string, show: boolean) {
    if (!show && visible.length <= 1) return;
    onChange({ order, visible: show ? [...visible, id] : visible.filter((v) => v !== id) });
  }

  function onKeyDown(e: KeyboardEvent, id: string) {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    focusAfterMove.current = id;
    reorder(id, order.indexOf(id) + (e.key === 'ArrowUp' ? -1 : 1));
  }

  const dragProps = (id: string) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      setDragging(id);
      // Firefox starts a drag only with data set; jsdom has no dataTransfer.
      e.dataTransfer?.setData('text/plain', id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    },
    onDragOver: (e: DragEvent) => {
      if (dragging === undefined) return;
      e.preventDefault();
      setOver(id);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      if (dragging !== undefined && dragging !== id) reorder(dragging, order.indexOf(id));
      setDragging(undefined);
      setOver(undefined);
    },
    onDragEnd: () => {
      setDragging(undefined);
      setOver(undefined);
    },
  });

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button icon={<Columns3 size={15} />} aria-label={t('table.columns')} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="ui-popover tbl-menu tbl-menu--columns" align="end" sideOffset={4} collisionPadding={8} aria-labelledby={titleId} onKeyDown={escapeFallback(() => setOpen(false))}>
          <h2 className="tbl-menu__title" id={titleId}>
            {t('table.columns.title')}
          </h2>
          <p className="tbl-menu__hint">{t('table.columns.hint')}</p>
          <ul className="tbl-menu__list">
            {order.map((id) => {
              const column = byId.get(id);
              if (!column) return null;
              const checked = shown.has(id);
              const last = checked && visible.length <= 1;
              // The drop line goes where the column will land: below the target when moving down.
              const landing =
                over === id && dragging !== undefined && dragging !== id
                  ? order.indexOf(id) > order.indexOf(dragging)
                    ? 'tbl-menu__item--after'
                    : 'tbl-menu__item--before'
                  : undefined;
              const cls = ['tbl-menu__item', dragging === id && 'tbl-menu__item--dragging', landing].filter(Boolean).join(' ');
              return (
                <li key={id} className={cls} {...dragProps(id)}>
                  <GripVertical className="tbl-menu__grip" aria-hidden="true" size={14} />
                  <label className="tbl-menu__label" title={last ? t('table.columns.lastVisible') : undefined}>
                    <SelectBox
                      ref={(el: HTMLButtonElement | null) => {
                        if (el) boxes.current.set(id, el);
                        else boxes.current.delete(id);
                      }}
                      checked={checked}
                      disabled={last}
                      onChange={(show) => toggle(id, show)}
                      onKeyDown={(e) => onKeyDown(e, id)}
                    />
                    <span>{column.header}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="tbl-menu__foot">
            <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={onReset}>
              {t('table.columns.reset')}
            </Button>
          </div>
          <p className="ui-sr-only" role="status">
            {announcement}
          </p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
