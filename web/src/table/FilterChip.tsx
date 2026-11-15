import { ChevronDown } from 'lucide-react';
import { Popover } from 'radix-ui';
import { useState } from 'react';
import type { Item } from '../api/types';
import { t } from '../i18n';
import type { Ctx } from '../resources/ctx';
import { Button, escapeFallback, type Option } from '../ui';
import { SelectBox } from './cells';
import type { FilterDef } from './filter';

/** Options longer than this get a box to narrow them down. */
const SEARCH_FROM = 8;

export interface FilterChipProps {
  filter: FilterDef;
  /** All items (not just the filtered ones): the choices come from the data. */
  items: Item[];
  ctx: Ctx;
  selected: string[];
  onChange: (values: string[]) => void;
}

/** A quick filter: a button with the selected count, opening a multi-select of the values in use. */
export function FilterChip({ filter, items, ctx, selected, onChange }: FilterChipProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          className={selected.length > 0 ? 'tbl-chip tbl-chip--on' : 'tbl-chip'}
          aria-label={
            selected.length > 0 ? t('table.filter.labelCount', { label: filter.label, count: selected.length }) : t('table.filter.label', { label: filter.label })
          }
        >
          <span className="tbl-chip__text">
            {filter.label}
            {selected.length > 0 && <span className="tbl-chip__count">{selected.length}</span>}
            <ChevronDown className="tbl-chip__chevron" size={14} aria-hidden="true" />
          </span>
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="ui-popover tbl-menu" align="start" sideOffset={4} collisionPadding={8} aria-label={filter.label} onKeyDown={escapeFallback(() => setOpen(false))}>
          {/* Mounted only while open: the options are computed from the data then. */}
          <Options filter={filter} items={items} ctx={ctx} selected={selected} onChange={onChange} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Options({ filter, items, ctx, selected, onChange }: FilterChipProps) {
  const [find, setFind] = useState('');
  const offered = filter.options(items, ctx);
  // A selected value no longer in the data stays listed, so it can be cleared.
  const stale: Option[] = selected.filter((v) => !offered.some((o) => o.value === v)).map((value) => ({ value, label: value }));
  const options = [...offered, ...stale];
  const needle = find.trim().toLowerCase();
  const shown = needle ? options.filter((o) => `${o.label} ${o.value}`.toLowerCase().includes(needle)) : options;
  const chosen = new Set(selected);

  const toggle = (value: string, on: boolean) =>
    onChange(on ? [...selected, value] : selected.filter((v) => v !== value));

  return (
    <>
      {options.length > SEARCH_FROM && (
        <input
          className="ui-input tbl-menu__find"
          type="search"
          value={find}
          placeholder={t('table.filter.search')}
          aria-label={t('table.filter.search')}
          onChange={(e) => setFind(e.target.value)}
        />
      )}
      {options.length === 0 ? (
        <p className="tbl-menu__hint">{t('table.filter.none')}</p>
      ) : shown.length === 0 ? (
        <p className="tbl-menu__hint">{t('table.filter.noMatches')}</p>
      ) : (
        <ul className="tbl-menu__list tbl-menu__list--scroll">
          {shown.map((option) => (
            <li key={option.value} className="tbl-menu__item">
              <label className="tbl-menu__label" title={option.description}>
                <SelectBox checked={chosen.has(option.value)} onChange={(on) => toggle(option.value, on)} />
                <span>{option.label}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="tbl-menu__foot">
        <Button size="sm" variant="ghost" disabled={selected.length === 0} onClick={() => onChange([])}>
          {t('table.filter.clear')}
        </Button>
      </div>
    </>
  );
}
