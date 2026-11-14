import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, LoaderCircle, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { t } from '../i18n';
import { Button, Select } from '../ui';
import type { PageModel } from './rows';
import { PAGE_SIZES, type PageSize } from './tableState';

const SIZE_OPTIONS = PAGE_SIZES.map((size) => ({ value: String(size), label: String(size) }));

export interface PagerProps {
  model: PageModel;
  pageSize: PageSize;
  onPage: (page: number) => void;
  onPageSize: (size: PageSize) => void;
}

/** "1–50 of 340", rows per page, and first / previous / next / last. */
export function Pager({ model, pageSize, onPage, onPageSize }: PagerProps) {
  const { page, pageCount } = model;
  const first = page === 0;
  const last = page >= pageCount - 1;
  return (
    <div className="tbl-pager">
      <span className="tbl-pager__range">{t('table.page.range', { start: model.start, end: model.end, total: model.total })}</span>
      <span className="tbl-pager__size">
        <span className="tbl-pager__label" aria-hidden="true">
          {t('table.page.size')}
        </span>
        <span className="tbl-pager__select">
          <Select
            aria-label={t('table.page.size')}
            value={String(pageSize)}
            options={SIZE_OPTIONS}
            onChange={(v) => {
              const size = PAGE_SIZES.find((s) => String(s) === v);
              if (size) onPageSize(size);
            }}
          />
        </span>
      </span>
      <span className="tbl-pager__nav">
        <Button size="sm" variant="ghost" icon={<ChevronsLeft size={15} />} aria-label={t('table.page.first')} disabled={first} onClick={() => onPage(0)} />
        <Button size="sm" variant="ghost" icon={<ChevronLeft size={15} />} aria-label={t('table.page.prev')} disabled={first} onClick={() => onPage(page - 1)} />
        <span className="tbl-pager__page">{t('table.page.of', { page: page + 1, count: pageCount })}</span>
        <Button size="sm" variant="ghost" icon={<ChevronRight size={15} />} aria-label={t('table.page.next')} disabled={last} onClick={() => onPage(page + 1)} />
        <Button
          size="sm"
          variant="ghost"
          icon={<ChevronsRight size={15} />}
          aria-label={t('table.page.last')}
          disabled={last}
          onClick={() => onPage(pageCount - 1)}
        />
      </span>
    </div>
  );
}

export interface SelectionBarProps {
  count: number;
  /** The bulk action buttons. */
  actions: ReactNode;
  /** While a bulk action runs: how far it got. */
  progress?: { done: number; total: number };
  onClear: () => void;
}

/** "N selected", the bulk actions, and a way out. */
export function SelectionBar({ count, actions, progress, onClear }: SelectionBarProps) {
  return (
    <div className="tbl-selbar" role="group" aria-label={t('table.selected', { count })}>
      <span className="tbl-selbar__count">{t('table.selected', { count })}</span>
      <span className="tbl-selbar__actions">{actions}</span>
      {progress && (
        <span className="tbl-selbar__progress" role="status">
          <LoaderCircle className="ui-spin" size={14} aria-hidden="true" />
          {t('table.bulk.progress', progress)}
        </span>
      )}
      <Button size="sm" variant="ghost" icon={<X size={14} />} disabled={progress !== undefined} onClick={onClear}>
        {t('table.clearSelection')}
      </Button>
    </div>
  );
}
