// The route's conditions (`vars`, lua-resty-expr): one row per condition (variable, not, operator,
// value), all AND-ed, for a flat list; a JSON editor for anything else (AND/OR groups, shapes the
// rows can't show), whose value is emitted only once it is edited. What a row shows but can't emit
// (a value without a variable, text that is not a number) is held from Save (usePending), and rows
// keep ids of their own, so held text stays on its row when another one goes.
import { ArrowDown, ArrowUp, Braces, List, Plus, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FC } from 'react';
import { deepEqual } from '../../editor/draft';
import { t } from '../../i18n';
import { Button, Checkbox, CodeEditor, Field, PendingScope, Select, TagInput, useEditingState, useHeld, useLocked, usePending } from '../../ui';
import { ReadOnlyValue } from '../../ui/ReadOnly';
import { addrProblem } from './validate';
import {
  blankRow, conditionOf, describeCondition, edited, heldMessage, LISTS, OPERATORS, representable, resultOf, rowsFor, rowsOf, valueOfRows, type Row,
} from './vars';
import './routes.css';

export interface VarsBuilderProps {
  value: unknown;
  /** The next conditions; undefined when there are none (the key is removed). */
  onChange: (v: unknown) => void;
  error?: string;
}

/** Variables worth suggesting (NGINX's and APISIX's, as ctx.var resolves them). */
const SUGGESTIONS = ['arg_', 'http_', 'cookie_', 'post_arg.', 'uri', 'request_uri', 'request_method', 'host', 'remote_addr', 'server_port', 'scheme', 'query_string'];

const OPERATOR_OPTIONS = OPERATORS.map((op) => ({ value: op, label: op, description: t(`rt.vars.op.${op}`) }));

/** One condition per line: shorter than JSON.stringify's indentation, and each line reads as one condition. */
function format(value: unknown): string {
  if (value === undefined) return '';
  if (!Array.isArray(value)) return JSON.stringify(value, null, 2);
  return value.length === 0 ? '[]' : `[\n${value.map((c) => `  ${JSON.stringify(c)}`).join(',\n')}\n]`;
}

type Parsed = { ok: true; value: unknown } | { ok: false; message: string };

function parse(text: string): Parsed {
  if (text.trim() === '') return { ok: true, value: undefined };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, message: t('rt.vars.held.json') };
  }
  if (!Array.isArray(value)) return { ok: false, message: t('rt.vars.held.jsonList') };
  return { ok: true, value: value.length > 0 ? value : undefined };
}

export const VarsBuilder: FC<VarsBuilderProps> = ({ value, onChange, error }) => {
  const locked = useLocked();
  // View state: rows or JSON. Rows only while they can show the value; JSON never switches back by itself.
  const [chosen, setMode] = useState<'rows' | 'json'>(() => (representable(value) ? 'rows' : 'json'));
  const mode = chosen === 'rows' && !representable(value) ? 'json' : chosen;
  if (mode !== chosen) setMode(mode);
  const held = useHeld();
  const bodyRef = useRef<HTMLDivElement>(null);

  if (locked) return <LockedVars value={value} error={error} />;

  return (
    <Field label={t('rt.vars.label')} help={t('rt.vars.help')} error={error}>
      <div ref={bodyRef} className="rt-vars">
        <PendingScope onChange={held.track}>
          {mode === 'rows' ? (
            <Rows value={value} onChange={onChange} onJson={() => !held.refuse(bodyRef.current) && setMode('json')} />
          ) : (
            <JsonVars value={value} onChange={onChange} onRows={() => setMode('rows')} />
          )}
        </PendingScope>
      </div>
    </Field>
  );
};

/** The rows editor. Its rows are this editing session's (useEditingState): Save and Discard rebuild them from the value. */
function Rows({ value, onChange, onJson }: { value: unknown; onChange: (v: unknown) => void; onJson: () => void }) {
  const [rows, setRows] = useEditingState(() => rowsOf(value));
  // A value from outside that the rows don't make replaces them, but for rows that hold something.
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    const next = rowsFor(value, rows);
    if (next !== rows) setRows(next);
  }
  usePending(heldMessage(rows));
  const listId = useId();
  const groupRef = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState<{ row: number }>();
  useEffect(() => {
    if (focus) groupRef.current?.querySelector<HTMLElement>(`[data-row="${focus.row}"] .rt-vars__variable`)?.focus();
  }, [focus]);

  function update(next: Row[]) {
    setRows(next);
    const emitted = valueOfRows(next);
    if (!deepEqual(emitted, value)) onChange(emitted);
  }
  const edit = (id: number, patch: Partial<Omit<Row, 'id' | 'touched' | 'last'>>) => update(rows.map((row) => (row.id === id ? edited(row, patch) : row)));
  const move = (from: number, to: number) => {
    const next = [...rows];
    const [row] = next.splice(from, 1);
    if (row) next.splice(to, 0, row);
    update(next);
  };
  const add = () => {
    const row = blankRow();
    setRows([...rows, row]);
    setFocus({ row: row.id });
  };

  return (
    <div className="rt-vars__rows" ref={groupRef}>
      {rows.length > 0 && (
        <div className="rt-vars__head" aria-hidden="true">
          <span>{t('rt.vars.variable')}</span>
          <span />
          <span>{t('rt.vars.operator')}</span>
          <span>{t('rt.vars.value')}</span>
        </div>
      )}
      {rows.map((row, i) => {
        const n = i + 1;
        const result = resultOf(row, n);
        const problem = result.kind === 'held' ? result : undefined;
        const list = LISTS.has(row.op);
        const messageId = `${listId}-${row.id}-problem`;
        return (
          <div key={row.id} className="rt-vars__row" data-row={row.id}>
            <input
              className="ui-input mono rt-vars__variable"
              aria-label={t('rt.vars.variableN', { n })}
              aria-invalid={problem?.on === 'variable' || undefined}
              aria-describedby={problem?.on === 'variable' ? messageId : undefined}
              list={listId}
              placeholder={t('rt.vars.variablePlaceholder')}
              value={row.variable}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => edit(row.id, { variable: e.target.value })}
            />
            <span className="rt-vars__not">
              <Checkbox aria-label={t('rt.vars.notN', { n })} checked={row.not} onChange={(not) => edit(row.id, { not })}>
                {t('rt.vars.not')}
              </Checkbox>
            </span>
            <span className="rt-vars__cell">
              <Select aria-label={t('rt.vars.operatorN', { n })} mono value={row.op} options={OPERATOR_OPTIONS} onChange={(op) => op && edit(row.id, { op: op as Row['op'] })} />
            </span>
            {list ? (
              <span className="rt-vars__cell">
                <TagInput
                  aria-label={t('rt.vars.valuesN', { n })}
                  fieldName={t('rt.vars.valuesN', { n })}
                  mono
                  value={row.list}
                  validate={row.op === 'ipmatch' ? addrProblem : undefined}
                  error={problem?.on === 'value' ? problem.message : undefined}
                  onChange={(next) => edit(row.id, { list: next })}
                />
              </span>
            ) : (
              <input
                className="ui-input mono"
                aria-label={t('rt.vars.valueN', { n })}
                aria-invalid={problem?.on === 'value' || undefined}
                aria-describedby={problem?.on === 'value' ? messageId : undefined}
                value={row.text}
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => edit(row.id, { text: e.target.value })}
              />
            )}
            <span className="rt-vars__tools">
              <Button variant="ghost" icon={<ArrowUp size={14} />} aria-label={t('rt.vars.upN', { n })} disabled={i === 0} onClick={() => move(i, i - 1)} />
              <Button variant="ghost" icon={<ArrowDown size={14} />} aria-label={t('rt.vars.downN', { n })} disabled={i === rows.length - 1} onClick={() => move(i, i + 1)} />
              <Button variant="ghost" icon={<X size={15} />} aria-label={t('rt.vars.removeN', { n })} onClick={() => update(rows.filter((r) => r.id !== row.id))} />
            </span>
            {problem && !(list && problem.on === 'value') && (
              <p className="rt-vars__problem" id={messageId}>
                {problem.message}
              </p>
            )}
          </div>
        );
      })}
      <datalist id={listId}>
        {SUGGESTIONS.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <div className="rt-vars__foot">
        <Button variant="secondary" size="sm" icon={<Plus size={13} />} onClick={add}>
          {t('rt.vars.add')}
        </Button>
        <Button variant="ghost" size="sm" icon={<Braces size={13} />} onClick={onJson}>
          {t('rt.vars.asJson')}
        </Button>
        {rows.length > 1 && <span className="rt-vars__and">{t('rt.vars.allMatch')}</span>}
      </div>
    </div>
  );
}

/** The whole value as JSON text. Text that doesn't parse, or isn't a list, is held; it is never replaced from outside. */
function JsonVars({ value, onChange, onRows }: { value: unknown; onChange: (v: unknown) => void; onRows: () => void }) {
  const [state, setState] = useState(() => ({ text: format(value), synced: value }));
  const parsed = parse(state.text);
  if (value !== state.synced) {
    const replace = parsed.ok && !deepEqual(parsed.value, value);
    setState({ text: replace ? format(value) : state.text, synced: value });
  }
  usePending(parsed.ok ? undefined : parsed.message);
  // Back to rows only while the text is a value the rows can show.
  const canRows = parsed.ok && representable(parsed.value);
  const note = representable(value) ? undefined : t('rt.vars.jsonNote');

  return (
    <div className="rt-vars__json">
      {note && <p className="rt-vars__note">{note}</p>}
      <CodeEditor
        language="json"
        aria-label={t('rt.vars.json')}
        aria-invalid={!parsed.ok || undefined}
        minLines={3}
        maxLines={16}
        value={state.text}
        onChange={(text) => {
          setState((s) => ({ ...s, text }));
          const next = parse(text);
          if (next.ok && !deepEqual(next.value, value)) onChange(next.value);
        }}
      />
      {!parsed.ok && <p className="rt-vars__problem">{parsed.message}</p>}
      {canRows && (
        <div className="rt-vars__foot">
          <Button variant="ghost" size="sm" icon={<List size={13} />} onClick={onRows}>
            {t('rt.vars.asRows')}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Locked: the conditions as a list (values as JSON, so "1" and 1 differ), or the JSON when the rows can't show it. */
function LockedVars({ value, error }: { value: unknown; error?: string }) {
  const titleId = useId();
  if (!representable(value)) {
    return (
      <Field label={t('rt.vars.label')} error={error}>
        <CodeEditor language="json" aria-label={t('rt.vars.json')} minLines={1} maxLines={16} value={format(value)} onChange={() => {}} />
      </Field>
    );
  }
  const conditions = Array.isArray(value) ? value.flatMap((raw) => conditionOf(raw) ?? []) : [];
  return (
    <Field label={<span id={titleId}>{t('rt.vars.label')}</span>} error={error}>
      {conditions.length === 0 ? (
        <ReadOnlyValue>{t('rt.vars.none')}</ReadOnlyValue>
      ) : (
        <>
          <ol className="rt-vars-ro" aria-labelledby={titleId}>
            {conditions.map((c, i) => {
              const line = describeCondition(c);
              return (
                <li key={i} className="rt-vars-ro__item mono">
                  <span className="rt-vars-ro__var">{line.variable}</span>
                  <span className="rt-vars-ro__op" title={line.meaning}>
                    {line.op}
                  </span>
                  <span className="rt-vars-ro__value">{line.value}</span>
                  <span className="rt-vars-ro__meaning">({line.meaning})</span>
                </li>
              );
            })}
          </ol>
          {conditions.length > 1 && <p className="rt-vars-ro__and">{t('rt.vars.allMatch')}</p>}
        </>
      )}
    </Field>
  );
}
