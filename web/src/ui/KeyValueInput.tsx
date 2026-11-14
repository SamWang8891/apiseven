import { Plus, X } from 'lucide-react';
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { Button } from './Button';
import { Field, type FieldProps } from './Field';
import { nameOfField } from './fieldIds';
import { useEditingState, useLocked } from './LockContext';
import { usePending } from './PendingContext';
import { changedEntry, commitEntry, entriesOf, entryHeld, entryRefusals, keepHeldRows, type EntryRow, type EntryRules } from './entryRows';
import { ReadOnlyValue } from './ReadOnly';
import './collection.css';

export type KeyValueInputProps = FieldProps & {
  value: Record<string, string>;
  /**
   * The map in row order. A row whose key is empty or another row's leaves its last committed entry
   * in the map, in its place, until the key is good again (entryRows.ts); a row emptied completely,
   * or removed, takes its entry out.
   */
  onChange: (v: Record<string, string>) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  mono?: boolean;
  disabled?: boolean;
  /** How a refused Save names the field while a row holds input; default: the label (if text). */
  fieldName?: string;
};

type Row = EntryRow<string>;

/** The marker of a key another row shows (the field's message names the key). */
const DUPLICATE = 'duplicate';
/** The marker of a row carried over a change of the value from outside (held until edited). */
const CARRIED = 'carried';
const RULES: EntryRules<string> = {
  duplicate: () => DUPLICATE,
  blank: (row) => row.key === '' && row.value === '',
  carried: () => CARRIED,
};

let lastRowId = 0;
/** A row; one made from an entry of the map has that entry as its last (it is in the map). */
const newRow = (key = '', value = '', fromMap = false): Row => ({ id: ++lastRowId, key, value, last: fromMap ? { key, value } : undefined });
/** One row per entry; an empty map gets one blank row, ready to type into (blank rows are not emitted). */
function toRows(map: Record<string, string>): Row[] {
  const rows = Object.entries(map).map(([k, v]) => newRow(k, v, true));
  return rows.length > 0 ? rows : [newRow()];
}

/** The rows for a map that came from outside, keeping the rows that hold input (never dropped). */
function rowsFor(map: Record<string, string>, rows: Row[]): Row[] {
  const fresh = Object.entries(map).map(([k, v]) => newRow(k, v, true));
  const next = keepHeldRows(fresh, rows, RULES);
  return next.length > 0 ? next : [newRow()];
}

const toMap = (rows: Row[]): Record<string, string> => entriesOf(rows, RULES);

function sameMap(a: Record<string, string>, b: Record<string, string>): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  return ak.length === bk.length && ak.every((k, i) => k === bk[i] && a[k] === b[k]);
}

/** What the rows hold that isn't in the map as shown (a value without a key, a repeated key), as one message. */
function heldRows(rows: Row[], field: string): string | undefined {
  const refused = entryRefusals(rows, RULES);
  const messages = rows.flatMap((row, i) => {
    const refusal = refused[i];
    if (!entryHeld(row, refusal, RULES)) return [];
    if (refusal === CARRIED) return [t('ui.pending.kept', { field, n: i + 1 })];
    return [refusal === '' ? t('ui.pending.noKey', { field, n: i + 1 }) : t('ui.pending.duplicateKey', { field, key: row.key })];
  });
  return messages.length > 0 ? messages.join('; ') : undefined;
}

/**
 * Editable rows of key/value pairs (labels, headers, vars). Locked: a two-column list. A row the map
 * leaves out though it holds something (a value without a key, a repeated key) holds Save (usePending).
 */
export function KeyValueInput({ label, help, error, required, value, onChange, keyPlaceholder, valuePlaceholder, mono, disabled, fieldName }: KeyValueInputProps) {
  const locked = useLocked();
  // Rows being typed belong to the editing session: Save and Discard start them over from the value.
  const [rows, setRows] = useEditingState(() => toRows(value));
  // A value from outside that differs from what the rows say replaces the rows, but for rows that
  // hold something the map left out: those stay, as typed.
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    if (!sameMap(toMap(rows), value)) setRows(rowsFor(value, rows));
  }
  // The rows and the map last sent, as of the last change, also before it renders: every handler
  // reads them here, so two changes in one task build on each other, never on an older render's rows.
  const latest = useRef({ rows, sent: value });
  useLayoutEffect(() => {
    latest.current = { rows, sent: value };
  });
  const [focus, setFocus] = useState<{ row: number } | { removedAt: number }>();
  const groupRef = useRef<HTMLDivElement>(null);
  usePending(locked ? undefined : heldRows(rows, nameOfField(fieldName, label, undefined)));

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

  /**
   * The one way the rows change (entryRows.ts rule 1): typing, leaving a row, adding, removing all
   * come here, and the map the rows make is sent whenever it differs from the value.
   */
  function update(next: Row[]) {
    // Nothing changed (leaving a row that commits nothing): no state update at all. A no-op update
    // still queued would be replayed over a later resync from outside and bring the old rows back.
    if (next === latest.current.rows) return;
    const { sent } = latest.current;
    const map = toMap(next);
    const send = !sameMap(map, sent);
    latest.current = { rows: next, sent: send ? map : sent };
    setRows(next);
    if (send) onChange(map);
  }
  const current = () => latest.current.rows;
  /** Leaving a row: a good entry becomes the one the row keeps in the map while it later holds input. */
  const commit = (id: number) => update(commitEntry(current(), id, RULES));

  const edit = (id: number, patch: Partial<Pick<Row, 'key' | 'value'>>) => update(current().map((r) => (r.id === id ? changedEntry({ ...r, ...patch }, RULES) : r)));
  // A row that holds input is flagged on its key (a blank row is not): a repeated key, a value
  // without a key, or a row carried over an outside change.
  const refused = entryRefusals(rows, RULES);
  const duplicate = refused.map((r) => r === DUPLICATE);
  const noKey = refused.map((r, i) => r === '' && rows[i]?.value !== '');
  const carried = refused.map((r) => r === CARRIED);
  const shownError =
    error ?? (carried.some(Boolean) ? t('ui.kv.kept') : duplicate.some(Boolean) ? t('ui.kv.duplicate') : noKey.some(Boolean) ? t('ui.kv.noKey') : undefined);
  const inputClass = mono ? 'ui-input mono' : 'ui-input';

  const add = !disabled && (
    <Button
      variant="ghost"
      size="sm"
      className="ui-kv__add"
      icon={<Plus size={13} />}
      onClick={() => {
        const row = newRow();
        update([...current(), row]);
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
              aria-invalid={duplicate[i] || noKey[i] || carried[i] || undefined}
              placeholder={keyPlaceholder ?? t('ui.kv.key')}
              value={row.key}
              disabled={disabled}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => edit(row.id, { key: e.target.value })}
              onBlur={() => commit(row.id)}
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
              onBlur={() => commit(row.id)}
            />
            {!disabled && (
              <Button
                variant="ghost"
                className="ui-kv__remove"
                icon={<X size={15} />}
                aria-label={t('ui.kv.remove', { n: i + 1 })}
                onClick={() => {
                  const rest = current().filter((r) => r.id !== row.id);
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
