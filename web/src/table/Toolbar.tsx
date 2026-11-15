import { ChevronLeft, ChevronRight, Plus, RefreshCw, Rows3, Rows4, Search } from 'lucide-react';
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

/** The width of the row's faded end (toolbar.css): a chip brought into view is clear of it. */
const FADE = 36;

/** Scrolls the row just enough that `chip` shows whole, clear of the faded ends. */
function reveal(row: HTMLElement, chip: HTMLElement): void {
  const r = row.getBoundingClientRect();
  const c = chip.getBoundingClientRect();
  if (c.right + FADE > r.right) row.scrollLeft += c.right + FADE - r.right;
  else if (c.left - FADE < r.left) row.scrollLeft -= r.left - (c.left - FADE);
}

/**
 * The filter chips in one row. When the window is too narrow for all of them the row scrolls
 * sideways: a chip that takes focus scrolls fully into view (scroll padding clears the fade), a
 * button at each end that hides chips scrolls to them (for the pointer: the keyboard reaches every
 * chip with Tab), the end fades while more follow, and a chip with an active filter is scrolled into
 * view when the list opens. Chips are watched too, so a count pill appearing is taken into account.
 */
function Filters({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ before: false, after: false });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      const next = { before: el.scrollLeft > 1, after: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 };
      setEdges((now) => (now.before === next.before && now.after === next.after ? now : next));
    };
    // An active filter's chip is in view from the start, and stays so while the row changes size (the
    // "3 of 73" count appearing beside it narrows it once the list is in).
    const showActive = () => {
      const on = el.querySelector<HTMLElement>('.tbl-chip--on');
      if (on) reveal(el, on);
    };
    showActive();
    check();
    // A chip that takes focus shows whole (the browser leaves a half-shown one where it is).
    const onFocus = (e: FocusEvent) => {
      const chip = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>('.tbl-toolbar__filters > *') : null;
      if (chip) reveal(el, chip);
    };
    el.addEventListener('focusin', onFocus);
    let width = el.clientWidth;
    const observer =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            if (el.clientWidth !== width) {
              width = el.clientWidth;
              showActive();
            }
            check();
          })
        : undefined;
    observer?.observe(el);
    const watch = () => {
      for (const chip of el.children) observer?.observe(chip);
    };
    watch();
    const added = typeof MutationObserver === 'function' ? new MutationObserver(() => (watch(), check())) : undefined;
    added?.observe(el, { childList: true });
    el.addEventListener('scroll', check, { passive: true });
    return () => {
      observer?.disconnect();
      added?.disconnect();
      el.removeEventListener('scroll', check);
      el.removeEventListener('focusin', onFocus);
    };
  }, []);
  // A view's width at a time, less the faded ends: what was half-shown at one end shows whole at the other.
  const scroll = (direction: 1 | -1) => {
    const el = ref.current;
    el?.scrollBy({ left: direction * Math.max(FADE, el.clientWidth - 2 * FADE), behavior: 'smooth' });
  };
  const fade = [edges.before && 'tbl-toolbar__filters--before', edges.after && 'tbl-toolbar__filters--more'].filter(Boolean).join(' ');
  return (
    <div className="tbl-toolbar__chips">
      {edges.before && (
        <Button size="sm" variant="ghost" className="tbl-toolbar__scroll tbl-toolbar__scroll--start" tabIndex={-1} icon={<ChevronLeft size={15} />} aria-label={t('table.filters.earlier')} onClick={() => scroll(-1)} />
      )}
      <div ref={ref} className={fade ? `tbl-toolbar__filters ${fade}` : 'tbl-toolbar__filters'}>
        {children}
      </div>
      {edges.after && (
        <Button size="sm" variant="ghost" className="tbl-toolbar__scroll tbl-toolbar__scroll--end" tabIndex={-1} icon={<ChevronRight size={15} />} aria-label={t('table.filters.more')} onClick={() => scroll(1)} />
      )}
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
