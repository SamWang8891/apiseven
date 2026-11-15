import { Plus, RefreshCw, Rows3, Rows4, Search } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useInvalidate } from '../api/hooks';
import { useReadOnlyKey } from '../api/write';
import type { Kind, Parent } from '../api/types';
import { t } from '../i18n';
import { newPathFor } from '../router/paths';
import { Button } from '../ui';

/** True while the user types into a field, where "/" is a character, not a shortcut. */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.closest('[role="textbox"]') !== null;
}

/** The search box: matches any field; "/" focuses it (when `shortcut`), Escape clears it. */
export function SearchBox({ value, onChange, label, shortcut }: { value: string; onChange: (v: string) => void; label: string; shortcut: boolean }) {
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!shortcut) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || typing(e.target)) return;
      e.preventDefault();
      input.current?.focus();
      input.current?.select();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [shortcut]);

  return (
    <div className="tbl-search">
      <Search className="tbl-search__icon" size={15} aria-hidden="true" />
      <input
        ref={input}
        type="search"
        className="ui-input tbl-search__input"
        value={value}
        placeholder={t('table.search.placeholder')}
        aria-label={label}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value !== '') {
            e.preventDefault();
            onChange('');
          }
        }}
      />
      {shortcut && value === '' && (
        <kbd className="tbl-search__key" title={t('table.search.hint')} aria-hidden="true">
          /
        </kbd>
      )}
    </div>
  );
}

/** Reloads the kind's lists; spins until they are back. */
export function RefreshButton({ kind, parent }: { kind: Kind; parent?: Parent }) {
  const invalidate = useInvalidate();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      icon={<RefreshCw size={15} />}
      aria-label={t('table.refresh')}
      title={t('table.refresh')}
      loading={busy}
      onClick={() => {
        setBusy(true);
        void invalidate(kind, parent).finally(() => setBusy(false));
      }}
    />
  );
}

export function DensityButton({ compact, onChange }: { compact: boolean; onChange: (compact: boolean) => void }) {
  return (
    <Button
      icon={compact ? <Rows4 size={15} /> : <Rows3 size={15} />}
      aria-label={t('table.density.compact')}
      title={t('table.density.compact')}
      aria-pressed={compact}
      className={compact ? 'tbl-pressed' : undefined}
      onClick={() => onChange(!compact)}
    />
  );
}

/**
 * The primary "New <kind>" action, a link to the create page; `to` and `label` replace its target and
 * text (a table embedded in its owner's editor creates in that owner). Not there with a key that
 * turned out read-only: nothing it leads to could be saved.
 */
export function NewLink({ kind, parent, to, label }: { kind: Kind; parent?: Parent; to?: string; label?: string }) {
  if (useReadOnlyKey()) return null;
  return (
    <Link className="ui-btn ui-btn--primary ui-btn--md tbl-new" to={to ?? newPathFor(kind, parent)}>
      <span className="ui-btn__icon" aria-hidden="true">
        <Plus size={15} />
      </span>
      <span className="ui-btn__label">{label ?? t('page.new', { kind: t(`kind.${kind}.singular`) })}</span>
    </Link>
  );
}

/**
 * The filter chips in one row. When the window is too narrow for all of them the row scrolls
 * sideways (a chip that takes focus scrolls into view), and its right edge fades while more follow.
 */
function Filters({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    check();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(check) : undefined;
    observer?.observe(el);
    el.addEventListener('scroll', check, { passive: true });
    return () => {
      observer?.disconnect();
      el.removeEventListener('scroll', check);
    };
  }, []);
  return (
    <div ref={ref} className={more ? 'tbl-toolbar__filters tbl-toolbar__filters--more' : 'tbl-toolbar__filters'}>
      {children}
    </div>
  );
}

/**
 * Left: search and filter chips. Right: the result count, then the table's own controls. They are
 * view controls (`data-view-control`): they change how the list is shown, never data. One row: the
 * chips give way (scrolling sideways) before anything wraps.
 */
export function Toolbar({ search, filters, count, end }: { search: ReactNode; filters: ReactNode; count: ReactNode; end: ReactNode }) {
  return (
    <div className="shell-toolbar tbl-toolbar" data-view-control="">
      <div className="tbl-toolbar__start">
        {search}
        <Filters>{filters}</Filters>
      </div>
      <div className="tbl-toolbar__end">
        <span className="tbl-toolbar__count" aria-live="polite">
          {count}
        </span>
        {end}
      </div>
    </div>
  );
}
