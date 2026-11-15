import { Check, ChevronDown, Search, X } from 'lucide-react';
import { Popover } from 'radix-ui';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { t } from '../i18n';
import { Field, type FieldProps } from './Field';
import { useFieldIds } from './fieldIds';
import { useLocked } from './LockContext';
import { ReadOnlyValue } from './ReadOnly';
import { LabelTip } from './Tooltip';
import './select.css';

export interface Option {
  value: string;
  label: string;
  description?: string;
}

export type SelectProps = FieldProps & {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  options: Option[];
  /** Adds a filter box above the options (matches label, value and description). */
  searchable?: boolean;
  /** Adds a button that clears the value (emits undefined). */
  clearable?: boolean;
  placeholder?: string;
  mono?: boolean;
  /** Option descriptions in monospace (ids, addresses). */
  monoDescription?: boolean;
  id?: string;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
};

function matches(option: Option, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [option.label, option.value, option.description ?? ''].some((s) => s.toLowerCase().includes(q));
}

export function Select({
  label, help, error, required, htmlFor, value, onChange, options, searchable, clearable, placeholder, mono, monoDescription, id, disabled, className,
  'aria-label': ariaLabel,
}: SelectProps) {
  const locked = useLocked();
  const ids = useFieldIds(id ?? htmlFor, { help, error });
  const listId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const selected = options.find((o) => o.value === value);
  const filtered = searchable ? options.filter((o) => matches(o, query)) : options;
  const optionId = (i: number) => `${listId}-${i}`;
  const activeId = open && filtered[active] ? optionId(active) : undefined;
  const field = { label, help, error, required, htmlFor: locked ? undefined : ids.id };

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId]);

  if (locked) {
    return (
      <Field {...field}>
        <ReadOnlyValue mono={mono}>{selected?.label ?? value}</ReadOnlyValue>
      </Field>
    );
  }

  function show() {
    setQuery('');
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  }

  function choose(option: Option | undefined) {
    if (!option) return;
    onChange(option.value);
    setOpen(false);
  }

  function onTriggerKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      show();
    }
  }

  function onListKey(e: KeyboardEvent) {
    const last = filtered.length - 1;
    const moves: Record<string, () => number> = {
      ArrowDown: () => Math.min(last, active + 1),
      ArrowUp: () => Math.max(0, active - 1),
      Home: () => 0,
      End: () => last,
      PageDown: () => Math.min(last, active + 8),
      PageUp: () => Math.max(0, active - 8),
    };
    const move = moves[e.key];
    if (move && !(searchable && (e.key === 'Home' || e.key === 'End'))) {
      e.preventDefault();
      setActive(Math.max(0, move()));
    } else if (e.key === 'Enter' || (!searchable && e.key === ' ')) {
      e.preventDefault();
      choose(filtered[active]);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  }

  // An empty string that no option has is no selection: the placeholder, not an empty trigger.
  const display = selected?.label ?? (value === '' ? undefined : value);
  const classes = ['ui-select', error && 'ui-select--error', disabled && 'ui-select--disabled', className].filter(Boolean).join(' ');

  return (
    <Field {...field}>
      <Popover.Root open={open} onOpenChange={(next) => (next ? show() : setOpen(false))}>
        <Popover.Anchor asChild>
          <div className={classes}>
            <button
              ref={triggerRef}
              id={ids.id}
              type="button"
              role="combobox"
              aria-haspopup="listbox"
              aria-expanded={open}
              aria-controls={open ? listId : undefined}
              aria-label={ariaLabel}
              aria-invalid={error ? true : undefined}
              aria-required={required || undefined}
              aria-describedby={ids.describedBy}
              disabled={disabled}
              className="ui-select__trigger"
              onClick={() => (open ? setOpen(false) : show())}
              onKeyDown={onTriggerKey}
            >
              <span className={['ui-select__value', display === undefined && 'ui-select__value--placeholder', mono && display !== undefined && 'mono'].filter(Boolean).join(' ')}>
                {display ?? placeholder ?? t('ui.select.placeholder')}
              </span>
              <ChevronDown className="ui-select__chevron" aria-hidden="true" size={15} />
            </button>
            {clearable && value !== undefined && !disabled && (
              <LabelTip label={t('ui.select.clear')}>
                <button
                  type="button"
                  className="ui-select__clear"
                  aria-label={t('ui.select.clear')}
                  onClick={() => {
                    onChange(undefined);
                    triggerRef.current?.focus();
                  }}
                >
                  <X aria-hidden="true" size={14} />
                </button>
              </LabelTip>
            )}
          </div>
        </Popover.Anchor>
        <Popover.Portal>
          <Popover.Content
            className="ui-popover ui-select__popover"
            align="start"
            sideOffset={4}
            collisionPadding={8}
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              (searchRef.current ?? listRef.current)?.focus();
            }}
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              triggerRef.current?.focus();
            }}
          >
            {searchable && (
              <div className="ui-select__search">
                <Search aria-hidden="true" size={14} />
                <input
                  ref={searchRef}
                  type="text"
                  aria-label={t('ui.select.search')}
                  aria-controls={listId}
                  aria-activedescendant={activeId}
                  aria-autocomplete="list"
                  autoComplete="off"
                  spellCheck={false}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActive(0);
                  }}
                  onKeyDown={onListKey}
                />
              </div>
            )}
            <ul
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label={typeof label === 'string' ? label : ariaLabel}
              tabIndex={searchable ? -1 : 0}
              aria-activedescendant={searchable ? undefined : activeId}
              onKeyDown={searchable ? undefined : onListKey}
              className="ui-select__list"
            >
              {filtered.map((option, i) => (
                <li
                  key={option.value}
                  id={optionId(i)}
                  role="option"
                  aria-selected={option.value === value}
                  data-active={i === active || undefined}
                  className="ui-select__option"
                  onPointerMove={() => setActive(i)}
                  onClick={() => choose(option)}
                >
                  <span className="ui-select__check" aria-hidden="true">
                    {option.value === value && <Check size={14} strokeWidth={2.5} />}
                  </span>
                  <span className="ui-select__text">
                    <span className={mono ? 'ui-select__label mono' : 'ui-select__label'}>{option.label}</span>
                    {option.description && <span className={monoDescription ? 'ui-select__desc mono' : 'ui-select__desc'}>{option.description}</span>}
                  </span>
                </li>
              ))}
            </ul>
            {filtered.length === 0 && <p className="ui-select__empty">{t('ui.select.noMatches')}</p>}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </Field>
  );
}
