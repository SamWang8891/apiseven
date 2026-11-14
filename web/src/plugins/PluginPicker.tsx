// The "Add plugin" dialog: the plugins this APISIX has loaded that the scope can take, grouped by
// category in the docs' order, searchable by name and description. A combobox over a listbox:
// type to filter, arrows to move, Enter or a click to add. Plugins already configured show as added.
import { Search } from 'lucide-react';
import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import type { PluginInfo } from '../api/types';
import { t } from '../i18n';
import { Dialog } from '../ui';
import { CATEGORIES, catalog } from './catalog';
import { pluginsAvailable, type Scope } from './scope';

export interface PluginPickerProps {
  open: boolean;
  onClose: () => void;
  /** Called with the chosen plugin's name (never one already configured). */
  onPick: (name: string) => void;
  /** The scope's plugin set (the stream set for a stream route). */
  all: Record<string, PluginInfo>;
  scope: Scope;
  /** Names already configured. */
  configured: string[];
}

interface Row {
  name: string;
  description: string;
  added: boolean;
}

const ORDER = [...CATEGORIES, 'other'];

/** Every word of the query in the name or the description. */
function matches(row: Row, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const text = `${row.name} ${row.description}`.toLowerCase();
  return words.every((w) => text.includes(w));
}

/** How well a name matches the query: exact, then prefix, then substring, then (description only) last. */
function rank(name: string, query: string): number {
  const q = query.trim().toLowerCase();
  if (q === '' || name === q) return 0;
  if (name.startsWith(q)) return 1;
  return name.includes(q) ? 2 : 3;
}

/** The best-ranked name, the first shown among equals. */
function bestMatch(names: string[], query: string): string | undefined {
  let best: string | undefined;
  for (const name of names) if (best === undefined || rank(name, query) < rank(best, query)) best = name;
  return best;
}

export function PluginPicker({ open, onClose, onPick, all, scope, configured }: PluginPickerProps) {
  const ids = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<string>();

  const groups = useMemo(() => {
    const byCategory = new Map<string, Row[]>();
    for (const name of pluginsAvailable(all, scope)) {
      const entry = catalog[name];
      const row = { name, description: entry?.description ?? '', added: configured.includes(name) };
      if (!matches(row, query)) continue;
      const category = entry && ORDER.includes(entry.category) ? entry.category : 'other';
      byCategory.set(category, [...(byCategory.get(category) ?? []), row]);
    }
    return ORDER.filter((c) => byCategory.has(c)).map((c) => ({ category: c, rows: byCategory.get(c) ?? [] }));
  }, [all, scope, configured, query]);

  const selectable = groups.flatMap((g) => g.rows.filter((r) => !r.added).map((r) => r.name));
  // The active option (what Enter adds): the one moved to with the arrows while it is still shown,
  // else the best match for the query by name, so "limit" picks limit-conn rather than the
  // ai-rate-limiting row the AI category lists first.
  const current = active !== undefined && selectable.includes(active) ? active : bestMatch(selectable, query);
  const optionId = (name: string) => `${ids}-opt-${name}`;

  function pick(name: string | undefined) {
    if (name === undefined || configured.includes(name)) return;
    onPick(name);
  }

  function keys(e: KeyboardEvent<HTMLInputElement>) {
    const at = current === undefined ? -1 : selectable.indexOf(current);
    const move = (to: number) => {
      e.preventDefault();
      const next = selectable[Math.max(0, Math.min(selectable.length - 1, to))];
      setActive(next);
      if (next) document.getElementById(optionId(next))?.scrollIntoView?.({ block: 'nearest' });
    };
    if (e.key === 'ArrowDown') move(at + 1);
    else if (e.key === 'ArrowUp') move(at - 1);
    else if (e.key === 'Home' && e.ctrlKey) move(0);
    else if (e.key === 'End' && e.ctrlKey) move(selectable.length - 1);
    else if (e.key === 'Enter') {
      e.preventDefault();
      pick(current);
    }
  }

  const listId = `${ids}-list`;
  return (
    <Dialog open={open} onClose={onClose} title={t('pl.picker.title')} size="lg">
      <div className="pl-picker">
        <div className="pl-picker__search">
          <Search size={15} aria-hidden="true" className="pl-picker__icon" />
          <input
            // Focus goes here when the dialog opens (Radix keeps an element that already has focus).
            autoFocus
            className="pl-picker__input"
            role="combobox"
            aria-label={t('pl.picker.search')}
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={current !== undefined ? optionId(current) : undefined}
            placeholder={t('pl.picker.search')}
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={keys}
          />
        </div>
        <div id={listId} role="listbox" aria-label={t('pl.picker.title')} className="pl-picker__list">
          {groups.length === 0 && (
            <p className="pl-picker__empty">{query.trim() ? t('pl.picker.none', { query: query.trim() }) : t('pl.picker.empty')}</p>
          )}
          {groups.map(({ category, rows }) => (
            <div key={category} role="group" aria-labelledby={`${ids}-cat-${category}`} className="pl-picker__group">
              <div id={`${ids}-cat-${category}`} className="pl-picker__cat" role="presentation">
                {t(`pl.category.${category}`)}
              </div>
              {rows.map((row) => (
                <div
                  key={row.name}
                  id={optionId(row.name)}
                  role="option"
                  data-plugin={row.name}
                  aria-selected={row.name === current}
                  aria-disabled={row.added || undefined}
                  aria-labelledby={`${optionId(row.name)}-name`}
                  aria-describedby={row.description ? `${optionId(row.name)}-desc` : undefined}
                  className={['pl-option', row.name === current && 'pl-option--active', row.added && 'pl-option--added'].filter(Boolean).join(' ')}
                  onMouseMove={() => !row.added && row.name !== current && setActive(row.name)}
                  onClick={() => pick(row.name)}
                >
                  <span id={`${optionId(row.name)}-name`} className="pl-option__name mono">
                    {row.name}
                  </span>
                  {row.added && <span className="pl-option__added">{t('pl.picker.added')}</span>}
                  <span id={`${optionId(row.name)}-desc`} className="pl-option__desc" title={row.description || undefined}>
                    {row.description}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
