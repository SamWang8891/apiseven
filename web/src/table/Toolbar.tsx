import { Plus, RefreshCw, Rows3, Rows4, Search } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useInvalidate } from '../api/hooks';
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

/** The primary "New <kind>" action, a link to the create page. */
/** The create link of a kind; `to` and `label` replace its target and text (a table embedded in its owner's editor creates in that owner). */
export function NewLink({ kind, parent, to, label }: { kind: Kind; parent?: Parent; to?: string; label?: string }) {
  return (
    <Link className="ui-btn ui-btn--primary ui-btn--md tbl-new" to={to ?? newPathFor(kind, parent)}>
      <span className="ui-btn__icon" aria-hidden="true">
        <Plus size={15} />
      </span>
      <span className="ui-btn__label">{label ?? t('page.new', { kind: t(`kind.${kind}.singular`) })}</span>
    </Link>
  );
}

/** Left: search and filter chips. Right: the result count, then the table's own controls. */
export function Toolbar({ start, count, end }: { start: ReactNode; count: ReactNode; end: ReactNode }) {
  return (
    <div className="shell-toolbar tbl-toolbar">
      <div className="tbl-toolbar__start">{start}</div>
      <div className="tbl-toolbar__end">
        <span className="tbl-toolbar__count" aria-live="polite">
          {count}
        </span>
        {end}
      </div>
    </div>
  );
}
