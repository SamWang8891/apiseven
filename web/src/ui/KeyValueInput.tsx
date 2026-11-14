import { Plus, X } from 'lucide-react';
import { Fragment, useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { Button } from './Button';
import { Field, type FieldProps } from './Field';
import { useLocked } from './LockContext';
import { ReadOnlyValue } from './ReadOnly';
import './collection.css';

export type KeyValueInputProps = FieldProps & {
  value: Record<string, string>;
  /** The map in row order. Rows with an empty key, or a key already used above, are left out. */
  onChange: (v: Record<string, string>) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  mono?: boolean;
  disabled?: boolean;
};

interface Row {
  id: number;
  key: string;
  value: string;
}

let lastRowId = 0;
const newRow = (key = '', value = ''): Row => ({ id: ++lastRowId, key, value });
/** One row per entry; an empty map gets one blank row, ready to type into (blank rows are not emitted). */
function toRows(map: Record<string, string>): Row[] {
  const rows = Object.entries(map).map(([k, v]) => newRow(k, v));
  return rows.length > 0 ? rows : [newRow()];
}

function toMap(rows: Row[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const row of rows) {
    if (row.key !== '' && !Object.hasOwn(map, row.key)) map[row.key] = row.value;
  }
  return map;
}

function sameMap(a: Record<string, string>, b: Record<string, string>): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  return ak.length === bk.length && ak.every((k, i) => k === bk[i] && a[k] === b[k]);
}

/** Editable rows of key/value pairs (labels, headers, vars). Locked: a two-column list. */
export function KeyValueInput({ label, help, error, required, value, onChange, keyPlaceholder, valuePlaceholder, mono, disabled }: KeyValueInputProps) {
  const locked = useLocked();
  const [rows, setRows] = useState(() => toRows(value));
  // A value from outside that differs from what the rows say replaces the rows.
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    if (!sameMap(toMap(rows), value)) setRows(toRows(value));
  }
  const [focus, setFocus] = useState<{ row: number } | { removedAt: number }>();
  const groupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focus || !groupRef.current) return;
    const group = groupRef.current;
    const target =
      'row' in focus
        ? group.querySelector<HTMLElement>(`[data-row="${focus.row}"] .ui-kv__key`)
        : (group.querySelectorAll<HTMLElement>('.ui-kv__remove')[focus.removedAt] ?? group.querySelector<HTMLElement>('.ui-kv__add'));
    target?.focus();
  }, [focus]);

  if (locked) {
    const entries = Object.entries(value);
    return (
      <Field label={label} help={help} error={error} required={required}>
        {entries.length === 0 ? (
          <ReadOnlyValue>{undefined}</ReadOnlyValue>
        ) : (
          <dl className={mono ? 'ro-value ro-value--kv mono' : 'ro-value ro-value--kv'}>
            {entries.map(([k, v]) => (
              <Fragment key={k}>
                <dt>{k}</dt>
                <dd>{v === '' ? t('ui.empty') : v}</dd>
              </Fragment>
            ))}
          </dl>
        )}
      </Field>
    );
  }

  function update(next: Row[]) {
    setRows(next);
    const map = toMap(next);
    if (!sameMap(map, value)) onChange(map);
  }

  const edit = (id: number, patch: Partial<Row>) => update(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const seen = new Set<string>();
  const duplicate = rows.map((r) => {
    const repeated = r.key !== '' && seen.has(r.key);
    seen.add(r.key);
    return repeated;
  });
  const shownError = error ?? (duplicate.some(Boolean) ? t('ui.kv.duplicate') : undefined);
  const inputClass = mono ? 'ui-input mono' : 'ui-input';

  const add = !disabled && (
    <Button
      variant="ghost"
      size="sm"
      className="ui-kv__add"
      icon={<Plus size={13} />}
      onClick={() => {
        const row = newRow();
        setRows([...rows, row]);
        setFocus({ row: row.id });
      }}
    >
      {t('ui.kv.add')}
    </Button>
  );

  return (
    <Field label={label} help={help} error={shownError} required={required} action={add || undefined}>
      <div className="ui-kv" role="group" aria-label={typeof label === 'string' ? label : undefined} ref={groupRef}>
        {rows.map((row, i) => (
          <div className="ui-kv__row" key={row.id} data-row={row.id}>
            <input
              className={`${inputClass} ui-kv__key`}
              aria-label={t('ui.kv.keyN', { n: i + 1 })}
              aria-invalid={duplicate[i] || undefined}
              placeholder={keyPlaceholder ?? t('ui.kv.key')}
              value={row.key}
              disabled={disabled}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => edit(row.id, { key: e.target.value })}
            />
            <input
              className={`${inputClass} ui-kv__value`}
              aria-label={t('ui.kv.valueN', { n: i + 1 })}
              placeholder={valuePlaceholder ?? t('ui.kv.value')}
              value={row.value}
              disabled={disabled}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => edit(row.id, { value: e.target.value })}
            />
            {!disabled && (
              <Button
                variant="ghost"
                className="ui-kv__remove"
                icon={<X size={15} />}
                aria-label={t('ui.kv.remove', { n: i + 1 })}
                onClick={() => {
                  const rest = rows.filter((r) => r.id !== row.id);
                  if (rest.length > 0) {
                    update(rest);
                    setFocus({ removedAt: i });
                  } else {
                    // Never zero rows: the last one is replaced by a blank one, focused.
                    const blank = newRow();
                    update([blank]);
                    setFocus({ row: blank.id });
                  }
                }}
              />
            )}
          </div>
        ))}
      </div>
    </Field>
  );
}
