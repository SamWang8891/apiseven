import { Plus, X } from 'lucide-react';
import { use, useCallback, useEffect, useRef, useState, type FocusEvent, type ReactNode } from 'react';
import type { Obj } from '../../api/types';
import { t } from '../../i18n';
import { isObj, testPattern } from '../../schema/refs';
import { Button, Input, KeyValueInput, PendingScope, useEditingState, useLocked, usePending, type PendingEntry } from '../../ui';
import { changedEntry, commitEntry, entriesOf, entryHeld, entryRefusals, keepHeldRows, type EntryRow, type EntryRules } from '../../ui/entryRows';
import type { MapNode } from '../analyze';
import { RowNameContext, useFieldError, useFieldId, useFieldName, useLatest } from '../context';
import { blankOf, isEmpty, joinPath, mapMode, mapModeFits, type Key, type MapMode } from '../model';
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

type Row = EntryRow<unknown>;

/** The marker of a row whose key has no value yet (the row's own message names it). */
const NO_VALUE = 'no-value';
/** The marker of a row carried over a change of the value from outside (held until edited). */
const CARRIED = 'carried';

/**
 * The map's rules for its rows (entryRows.ts): a key another row has is refused, and so is a
 * changed key the key patterns refuse (a stored one that fails them stays until someone changes it);
 * a row without a value stays out. While a row holds input, the map keeps its last committed entry.
 */
function rulesOf(node: MapNode): EntryRules<unknown> {
  return {
    duplicate: (key) => t('sf.map.duplicate', { key }),
    refuseKey: (key) => badKey(node, key),
    refuseValue: (row) => (row.value === undefined ? NO_VALUE : undefined),
    blank: (row) => row.key === '' && isEmpty(row.value),
    carried: () => CARRIED,
  };
}

let lastRow = 0;
const toRows = (map: Obj): Row[] => Object.entries(map).map(([key, value]) => ({ id: ++lastRow, key, value, last: { key, value } }));

/** The map the rows stand for: each row's entry, or while it holds input, its last committed one. */
const toMap = (node: MapNode, rows: Row[]): Obj => entriesOf(rows, rulesOf(node));

/** The rows for a map that came from outside, keeping the rows that hold input (never dropped). */
const rowsFor = (node: MapNode, map: Obj, rows: Row[]): Row[] => keepHeldRows(toRows(map), rows, rulesOf(node));

/** An entry's text from the key/value editor as the map holds it, when it does (a number stays a number); else the text. */
const typedAt = (map: Obj, key: string, text: string): unknown => (map[key] !== undefined && textOf(map[key]) === text ? map[key] : text);

/**
 * The key/value editor's rows as rows of this renderer, each as it was (its key, its value, the entry it
 * last committed, held or not), so taking over from that editor loses no row's input (final wave D3).
 */
const rowsFromEditor = (map: Obj, rows: readonly EntryRow<string>[]): Row[] =>
  rows.map((row) => ({
    id: ++lastRow,
    key: row.key,
    value: typedAt(map, row.key, row.value),
    last: row.last && { key: row.last.key, value: typedAt(map, row.last.key, row.last.value) },
    carried: row.carried,
  }));

/**
 * What the rows hold that isn't in the map as shown, as one message: a value without a key, a
 * refused key, a key without a value. A new row with nothing typed in it holds nothing.
 */
function heldRows(rows: Row[], refused: (string | undefined)[], rules: EntryRules<unknown>, field: string): string | undefined {
  const messages = rows.flatMap((row, i) => {
    const refusal = refused[i];
    if (!entryHeld(row, refusal, rules)) return [];
    if (refusal === CARRIED) return [t('ui.pending.kept', { field, n: i + 1 })];
    if (refusal === '') return [t('ui.pending.noKey', { field, n: i + 1 })];
    if (refusal === NO_VALUE) return [t('ui.pending.noValue', { field, key: row.key })];
    // Not the row's own line ("only the first is kept"): while it holds, Save is refused and nothing is kept.
    if (refusal === rules.duplicate(row.key)) return [t('ui.pending.duplicateKey', { field, key: row.key })];
    return [t('ui.pending.problem', { field, problem: refusal ?? '' })];
  });
  return messages.length > 0 ? messages.join('; ') : undefined;
}

function sameMap(a: Obj, b: Obj): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  return ak.length === bk.length && ak.every((k, i) => k === bk[i] && Object.is(a[k], b[k]));
}

/**
 * Rows of key + field, for values a key/value editor cannot hold (numbers, lists, secrets, objects).
 * The rows are local, so a row being typed into (no key yet, a value cleared, a repeated key) stays
 * where it is while the map leaves it out, and holds Save meanwhile (usePending); a new value from
 * outside replaces them. Taking over from the key/value editor (`from`: its rows), they start as that
 * editor's rows.
 */
function MapRows({ node, value, path, emit, label, labelId, help, error, from, onTaken }: {
  node: MapNode;
  value: Obj;
  path: string;
  emit: (next: Obj) => void;
  label: ReactNode;
  labelId: string;
  help: ReactNode;
  error: string | undefined;
  from: readonly EntryRow<string>[] | undefined;
  /** Called once the rows have started from `from`: what they were handed is let go. */
  onTaken: () => void;
}) {
  const locked = useLocked();
  // Rows being typed belong to the editing session (the locked view shows them): Save and Discard
  // start them over from the value.
  const [rows, setRows] = useEditingState(() => (from ? rowsFromEditor(value, from) : toRows(value)));
  // Started from the key/value editor's rows: the field keeps no copy of them (Codex final pass 2b, V1).
  useEffect(() => {
    if (from !== undefined) onTaken();
  }, [from, onTaken]);
  // A value from outside replaces the rows, but for rows that hold something: those stay, as typed.
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    if (!sameMap(toMap(node, rows), value)) setRows(rowsFor(node, value, rows));
  }
  const latestRef = useLatest({ rows, value, emit });

  const rules = rulesOf(node);
  // The one way the rows change (entryRows.ts rule 1): typing, leaving a row, adding, removing all
  // come here, and the map the rows make is sent whenever it differs from the value.
  const update = useCallback(
    (next: Row[]) => {
      // Rows and the value as of the last change (also before it renders): changes in one task build on each other.
      // Nothing changed (leaving a row that commits nothing): no state update, which, queued, would be
      // replayed over a later resync from outside and bring the old rows back.
      if (next === latestRef.current.rows) return;
      const { value: cur, emit: send } = latestRef.current;
      const map = toMap(node, next);
      const changed = !sameMap(map, cur);
      latestRef.current = { ...latestRef.current, rows: next, value: changed ? map : cur };
      setRows(next);
      if (changed) send(map);
    },
    [latestRef, node, setRows],
  );
  const onValue = useCallback(
    (id: Key, v: unknown) => update(latestRef.current.rows.map((r) => (r.id === id ? changedEntry({ ...r, value: v }, rulesOf(node)) : r))),
    [latestRef, update, node],
  );
  /** Leaving a row: a good entry becomes the one the row keeps in the map while it later holds input. */
  const commit = (id: number) => update(commitEntry(latestRef.current.rows, id, rules));

  const refused = entryRefusals(rows, rules);
  const fieldName = useFieldName(path);
  const outerRow = use(RowNameContext);
  usePending(locked ? undefined : heldRows(rows, refused, rules, fieldName));

  return (
    <div className="sf-map" role="group" aria-labelledby={labelId}>
      <div className="sf-list__head">
        {label}
        {!locked && (
          <span className="sf-list__action">
            <Button variant="ghost" size="sm" icon={<Plus size={13} />} onClick={() => update([...latestRef.current.rows, { id: ++lastRow, key: '', value: blankOf(node.value) }])}>
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
            // A row the map leaves out though it holds something is flagged on its key: a refused
            // key, a value without a key, a key without a value. A stored key that fails the pattern
            // is shown as such, though the entry is kept.
            const refusal = refused[i];
            const unchanged = row.last !== undefined && row.key === row.last.key;
            const keyError =
              refusal === ''
                ? isEmpty(row.value)
                  ? undefined
                  : t('sf.map.noKey')
                : refusal === CARRIED
                  ? t('ui.kv.kept')
                  : refusal === NO_VALUE
                    ? row.key === ''
                      ? undefined
                      : t('sf.map.noValue')
                    : (refusal ?? (unchanged ? badKey(node, row.key) : undefined));
            return (
              <div className="sf-map__row" key={row.id} onBlur={() => commit(row.id)}>
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
                    onChange={(e) => update(latestRef.current.rows.map((r) => (r.id === row.id ? changedEntry({ ...r, key: e.target.value }, rules) : r)))}
                  />
                )}
                {/* A row without a key is named by its place in messages, never by its internal path; a keyed one, as around it. */}
                <RowNameContext value={row.key === '' ? { at: joinPath(path, `~${row.id}`), name: t('sf.map.rowName', { field: fieldName, n }) } : outerRow}>
                  <NodeField
                    node={node.value}
                    value={row.value}
                    name={row.id}
                    path={joinPath(path, row.key === '' ? `~${row.id}` : row.key)}
                    onChange={onValue}
                    required
                    ariaLabel={row.key === '' ? t('sf.map.valueOfEntry', { n }) : t('sf.map.valueOf', { key: row.key })}
                  />
                </RowNameContext>
                {!locked && (
                  <Button
                    variant="ghost"
                    icon={<X size={15} />}
                    aria-label={t('sf.map.remove', { key: row.key === '' ? n : row.key })}
                    onClick={() => update(latestRef.current.rows.filter((r) => r.id !== row.id))}
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

interface MapModeState {
  mode: MapMode;
  track: (entries: PendingEntry[]) => void;
  focus: { onFocus: () => void; onBlur: (e: FocusEvent) => void };
  /** For the key/value editor: its rows as they stand. */
  onRows: (rows: readonly EntryRow<string>[]) => void;
  /** For the rows: the key/value editor's rows they take over from, when they did on leaving it. */
  taken: readonly EntryRow<string>[] | undefined;
  /** For the rows: they have started from `taken`, which is let go. */
  onTaken: () => void;
}

/**
 * Which renderer shows the map: the one its value asks for (mapMode), except that one holding input
 * stays on the page (final wave D3: a removed row could otherwise turn rows into the key/value editor
 * and unmount another row's unfinished edit). Kept that way, it stays for the editing session (it
 * still shows the value), so finishing the edit does not swap the field under the keyboard either.
 * While the user is in the key/value editor it stays, whatever the value asks for (a private key typed
 * or pasted there shows until it is left: fix round 1, R1), with nothing set as it renders (Codex final
 * pass, X3: that looped); leaving it switches to the rows, which start from its rows, held ones too.
 */
function useMapMode(node: MapNode, value: unknown): MapModeState {
  const wanted = mapMode(node, value);
  /** Whether the renderer on the page holds input (its PendingScope). */
  const [holds, setHolds] = useState(false);
  /** Focus is in the key/value editor: a private key being typed there shows until it is left (fix round 1, R1), then rows hide it. */
  const [typing, setTyping] = useState(false);
  /** A renderer kept over a change while it held input: editing state (Save and Discard end it). */
  const [kept, setKept] = useEditingState<MapMode | undefined>(undefined);
  /** The renderer on the page. */
  const [shown, setShown] = useState(wanted);
  /**
   * The key/value editor's rows as they stand (its onRows), read when it is left; only while it is on
   * the page: no copy outlives it, so none holds a key the value no longer holds (Codex final pass 2b, V1).
   */
  const editorRows = useRef<readonly EntryRow<string>[] | undefined>(undefined);
  const onRows = useCallback((rows: readonly EntryRow<string>[]) => {
    editorRows.current = rows;
  }, []);
  /** The key/value editor's rows the rows took over from on leaving it, until the rows have started from them (V1). */
  const [taken, setTaken] = useEditingState<readonly EntryRow<string>[] | undefined>(undefined);
  const onTaken = useCallback(() => setTaken(undefined), [setTaken]);
  let mode = kept !== undefined && mapModeFits(node, value, kept) ? kept : wanted;
  if (mode !== shown) {
    if (typing && shown === 'kv') {
      // In the key/value editor: it stays until it is left (focus.onBlur switches then).
      mode = shown;
    } else if (holds && mapModeFits(node, value, shown)) {
      setKept(shown);
      mode = shown;
    } else {
      // The renderer going away tells nothing as it unmounts (PendingContext): it holds nothing from here.
      setShown(mode);
      setHolds(false);
      if (taken !== undefined) setTaken(undefined);
    }
  }
  const track = useCallback((entries: PendingEntry[]) => setHolds(entries.length > 0), []);
  useEffect(() => {
    if (mode !== 'kv') editorRows.current = undefined;
  }, [mode]);
  const focus = {
    onFocus: () => setTyping(true),
    onBlur: (e: FocusEvent) => {
      if ((e.currentTarget as HTMLElement).contains(e.relatedTarget)) return;
      setTyping(false);
      // Left with an entry the key/value editor can't show (a private key): the rows take over now,
      // from its rows as they stand, so another row's unfinished input stays on the page (D3).
      if (shown === 'kv' && wanted === 'rows') {
        setShown('rows');
        setHolds(false);
        setTaken(editorRows.current);
        editorRows.current = undefined;
      }
    },
  };
  return { mode, track, focus, onRows, taken, onTaken };
}

/**
 * A map (patternProperties / additionalProperties, or a free-form object): a key/value editor while
 * every entry is text its schema takes; rows of key + field for other values; JSON for entries the
 * value field cannot show; the renderer stays while it holds input (useMapMode). Emptied, it removes
 * its key unless required.
 */
export function MapField(props: FieldProps<MapNode>) {
  const { node, value, name, path, onChange, prop, required, ariaLabel } = props;
  const { mode, track, focus, onRows, taken, onTaken } = useMapMode(node, value);
  const id = useFieldId(path);
  const error = useFieldError(path);
  const help = useFieldHelp(prop, node, value);
  const fieldName = useFieldName(path);
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

  if (mode === 'json') {
    return (
      <PendingScope onChange={track}>
        <JsonField {...props} />
      </PendingScope>
    );
  }
  if (mode === 'rows') {
    return (
      <PendingScope onChange={track}>
        <MapRows node={node} value={map} path={path} emit={emit} label={label} labelId={labelId} help={help} error={error} from={taken} onTaken={onTaken} />
      </PendingScope>
    );
  }

  const text = Object.fromEntries(Object.entries(map).map(([k, v]) => [k, textOf(v)]));
  const refused = Object.keys(text)
    .map((k) => badKey(node, k))
    .find((m) => m !== undefined);
  return (
    <div className="sf-map" role="group" aria-labelledby={labelId} {...focus}>
      <PendingScope onChange={track}>
        <KeyValueInput
          label={label}
          help={help}
          error={error ?? refused}
          required={false}
          mono
          fieldName={fieldName}
          onRows={onRows}
          value={text}
          onChange={(next) => {
            // Entries left as they were keep their stored type (a number stays a number).
            const typed = Object.fromEntries(Object.entries(next).map(([k, s]) => [k, map[k] !== undefined && textOf(map[k]) === s ? map[k] : s]));
            emit(typed);
          }}
        />
      </PendingScope>
    </div>
  );
}
