import { Plus, X } from 'lucide-react';
import { useCallback, useState, type ReactNode } from 'react';
import type { Obj } from '../../api/types';
import { t } from '../../i18n';
import { isObj, testPattern } from '../../schema/refs';
import { Button, Input, KeyValueInput, useLocked } from '../../ui';
import type { MapNode } from '../analyze';
import { useFieldError, useFieldId, useLatest } from '../context';
import { blankOf, joinPath, mapMode, type Key } from '../model';
import { ErrorLine, FieldLabel, RequiredMark } from './chrome';
import { useFieldHelp } from './help';
import { JsonField } from './JsonField';
import { NodeField } from './NodeField';
import type { FieldProps } from './types';

const NONE: Obj = {};

/** An entry as text: strings as they are, numbers (all a key/value editor holds besides) as written. */
const textOf = (v: unknown): string => (typeof v === 'string' ? v : (JSON.stringify(v) ?? ''));

/** Why a key is refused by the map's key patterns, if it is. */
function badKey(node: MapNode, key: string): string | undefined {
  if (node.patterns.length === 0 || node.patterns.some((p) => testPattern(p, key))) return undefined;
  return t('sf.map.badKey', { key, pattern: node.patterns.join(' | ') });
}

interface Row {
  id: number;
  key: string;
  value: unknown;
}

let lastRow = 0;
const toRows = (map: Obj): Row[] => Object.entries(map).map(([key, value]) => ({ id: ++lastRow, key, value }));

/** The map the rows stand for: rows without a key or a value, with a repeated key or a refused one are left out. */
function toMap(node: MapNode, rows: Row[]): Obj {
  const out: Obj = {};
  for (const row of rows) {
    if (row.key !== '' && !(row.key in out) && row.value !== undefined && !badKey(node, row.key)) out[row.key] = row.value;
  }
  return out;
}

function sameMap(a: Obj, b: Obj): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  return ak.length === bk.length && ak.every((k, i) => k === bk[i] && Object.is(a[k], b[k]));
}

/**
 * Rows of key + field, for values a key/value editor cannot hold (numbers, lists, secrets, objects).
 * The rows are local, so a row being typed into (no key yet, a value cleared, a repeated key) stays
 * where it is while the map leaves it out; a new value from outside replaces them.
 */
function MapRows({ node, value, path, emit, label, labelId, help, error }: {
  node: MapNode;
  value: Obj;
  path: string;
  emit: (next: Obj) => void;
  label: ReactNode;
  labelId: string;
  help: ReactNode;
  error: string | undefined;
}) {
  const locked = useLocked();
  const [rows, setRows] = useState(() => toRows(value));
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    if (!sameMap(toMap(node, rows), value)) setRows(toRows(value));
  }
  const latestRef = useLatest({ rows, value, emit });

  const update = useCallback(
    (next: Row[]) => {
      const { value: cur, emit: send } = latestRef.current;
      latestRef.current = { ...latestRef.current, rows: next };
      setRows(next);
      const map = toMap(node, next);
      if (!sameMap(map, cur)) send(map);
    },
    [latestRef, node],
  );
  const onValue = useCallback(
    (id: Key, v: unknown) => update(latestRef.current.rows.map((r) => (r.id === id ? { ...r, value: v } : r))),
    [latestRef, update],
  );

  const counts = new Map<string, number>();
  rows.forEach((r) => counts.set(r.key, (counts.get(r.key) ?? 0) + 1));

  return (
    <div className="sf-map" role="group" aria-labelledby={labelId}>
      <div className="sf-list__head">
        {label}
        {!locked && (
          <span className="sf-list__action">
            <Button variant="ghost" size="sm" icon={<Plus size={13} />} onClick={() => update([...rows, { id: ++lastRow, key: '', value: blankOf(node.value) }])}>
              {t('sf.map.add')}
            </Button>
          </span>
        )}
      </div>
      {help !== undefined && <p className="sf-help">{help}</p>}
      {error !== undefined && <ErrorLine message={error} />}
      {locked && rows.length === 0 && <span className="sf-map__empty">{t('ui.empty')}</span>}
      {rows.length > 0 && (
        <div className="sf-map__rows">
          {rows.map((row, i) => {
            const n = i + 1;
            const keyError =
              row.key !== '' && (counts.get(row.key) ?? 0) > 1 && rows.findIndex((r) => r.key === row.key) !== i
                ? t('sf.map.duplicate', { key: row.key })
                : row.key === ''
                  ? undefined
                  : badKey(node, row.key);
            return (
              <div className="sf-map__row" key={row.id}>
                {locked ? (
                  <span className="sf-map__key mono">{row.key}</span>
                ) : (
                  <Input
                    aria-label={t('sf.map.keyOf', { n })}
                    mono
                    spellCheck={false}
                    autoComplete="off"
                    placeholder={t('sf.map.key')}
                    value={row.key}
                    error={keyError}
                    onChange={(e) => update(rows.map((r) => (r.id === row.id ? { ...r, key: e.target.value } : r)))}
                  />
                )}
                <NodeField
                  node={node.value}
                  value={row.value}
                  name={row.id}
                  path={joinPath(path, row.key === '' ? `~${row.id}` : row.key)}
                  onChange={onValue}
                  required
                  ariaLabel={row.key === '' ? t('sf.map.valueOfEntry', { n }) : t('sf.map.valueOf', { key: row.key })}
                />
                {!locked && (
                  <Button
                    variant="ghost"
                    icon={<X size={15} />}
                    aria-label={t('sf.map.remove', { key: row.key === '' ? n : row.key })}
                    onClick={() => update(rows.filter((r) => r.id !== row.id))}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * A map (patternProperties / additionalProperties, or a free-form object): a key/value editor while
 * every entry is text its schema takes; rows of key + field for other values; JSON for entries the
 * value field cannot show. Emptied, it removes its key unless required.
 */
export function MapField(props: FieldProps<MapNode>) {
  const { node, value, name, path, onChange, prop, required, ariaLabel } = props;
  const id = useFieldId(path);
  const error = useFieldError(path);
  const help = useFieldHelp(prop, node, value);
  const map = isObj(value) ? value : NONE;
  const latestRef = useLatest({ name, onChange, required });
  const emit = useCallback(
    (next: Obj) => {
      const { name: key, onChange: change, required: needed } = latestRef.current;
      change(key, Object.keys(next).length === 0 && !needed ? undefined : next);
    },
    [latestRef],
  );
  const key = prop?.key ?? ariaLabel ?? String(name);
  const labelId = `${id}-label`;
  // Without a property of its own (a variant's form, a list item) the label above already names it.
  const label = prop ? (
    <span className="sf-list__label" id={labelId}>
      <FieldLabel name={key} title={prop.title} />
      {required && <RequiredMark />}
    </span>
  ) : (
    <span className="sf-sr-only" id={labelId}>
      {key}
    </span>
  );

  const mode = mapMode(node, value);
  if (mode === 'json') return <JsonField {...props} />;
  if (mode === 'rows') return <MapRows node={node} value={map} path={path} emit={emit} label={label} labelId={labelId} help={help} error={error} />;

  const text = Object.fromEntries(Object.entries(map).map(([k, v]) => [k, textOf(v)]));
  const refused = Object.keys(text)
    .map((k) => badKey(node, k))
    .find((m) => m !== undefined);
  return (
    <div className="sf-map" role="group" aria-labelledby={labelId}>
      <KeyValueInput
        label={label}
        help={help}
        error={error ?? refused}
        required={false}
        mono
        value={text}
        onChange={(next) => {
          // Entries left as they were keep their stored type (a number stays a number).
          const typed = Object.fromEntries(Object.entries(next).map(([k, s]) => [k, map[k] !== undefined && textOf(map[k]) === s ? map[k] : s]));
          emit(typed);
        }}
      />
    </div>
  );
}
