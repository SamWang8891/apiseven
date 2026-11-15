// The fixed form for a plugin config's `_meta`, the options APISIX injects into every plugin schema
// (schema_def.lua plugin_injected_schema): disable (boolean), priority (integer), filter (an array
// of vars conditions), error_response (a string or an object). pre_function is not offered; it and
// any other key are kept as they are and named.
import { useRef, useState } from 'react';
import { isObj } from '../api/sanitize';
import type { Obj, PluginInfo } from '../api/types';
import { deepEqual } from '../editor/draft';
import { issueAt, type Issue } from '../editor/issues';
import { t } from '../i18n';
import { FieldLabel } from '../schema-form/fields/chrome';
import { CodeEditor, Field, NumberInput, PendingScope, Select, Switch, Textarea, useHeld, useLocked, usePending } from '../ui';

export interface MetaFormProps {
  /** The config's `_meta`. */
  meta: Obj | undefined;
  /** The next `_meta`; undefined when nothing is left in it. */
  onChange: (meta: Obj | undefined) => void;
  /** The plugin (its default priority). */
  info?: PluginInfo;
  /**
   * Whether to offer error_response (a stored one is always shown). APISIX sends it in place of the
   * body of any plugin that rejects an HTTP request (plugin.lua run_plugin, `code >= 400`), so it is
   * offered for every plugin except where it is never used: the stream subsystem (the session is
   * closed) and a consumer's or credential's sign-in plugin (its config is the credential).
   */
  offerErrorResponse?: boolean;
  /** Issues with paths relative to `_meta` (`priority`, `filter`, …). */
  issues: Issue[];
  /** Prefix of the fields' DOM ids. */
  idPrefix: string;
  /** The plugin's name, which messages about held input start with ("limit-count._meta.filter"). */
  name: string;
  /**
   * No `disable` switch: a consumer's or credential's auth plugin signs in whatever it says
   * (plugins/auth.ts). A stored `disable` is kept as it is and named with the other keys.
   */
  noDisable?: boolean;
}

const KNOWN = new Set(['disable', 'priority', 'filter', 'error_response']);

const pretty = (v: unknown): string => (v === undefined ? '' : (JSON.stringify(v, null, 2) ?? ''));

/** Whether `text` is `value` written as JSON (so the value coming back need not replace what was typed). */
function says(text: string, value: unknown): boolean {
  if (text.trim() === '') return value === undefined;
  try {
    return deepEqual(JSON.parse(text), value);
  } catch {
    return false;
  }
}

type Check = (parsed: unknown) => string | undefined;

/**
 * A JSON value edited as text: empty text removes it, text that does not parse (or that `check`
 * refuses) stays here with an error, is not emitted, and holds Save (usePending, named `fieldName`).
 */
function JsonValue({ value, onChange, label, ariaLabel, help, error, check, id, fieldName }: {
  value: unknown;
  onChange: (v: unknown) => void;
  label: string;
  ariaLabel: string;
  help?: string;
  error?: string;
  check: Check;
  id: string;
  fieldName: string;
}) {
  const locked = useLocked();
  /** `invalid` (shown) and `held` (for Save) are set while the text is not emitted. */
  const [state, setState] = useState(() => ({ text: pretty(value), synced: value, invalid: undefined as string | undefined, held: undefined as string | undefined }));
  // A value changed elsewhere replaces the text, unless the text holds Save: what was typed stays.
  let current = state;
  if (!Object.is(value, state.synced)) {
    current = state.held !== undefined || says(state.text, value) ? { ...state, synced: value } : { text: pretty(value), synced: value, invalid: undefined, held: undefined };
    setState(current);
  }
  usePending(locked ? undefined : current.held);

  function edit(text: string) {
    if (text.trim() === '') {
      setState({ text, synced: undefined, invalid: undefined, held: undefined });
      onChange(undefined);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      const invalid = t('pl.card.jsonInvalid', { error: e instanceof Error ? e.message : String(e) });
      setState((s) => ({ ...s, text, invalid, held: t('ui.pending.json', { field: fieldName }) }));
      return;
    }
    const refused = check(parsed);
    if (refused) {
      setState((s) => ({ ...s, text, invalid: refused, held: t('ui.pending.problem', { field: fieldName, problem: refused }) }));
      return;
    }
    setState({ text, synced: parsed, invalid: undefined, held: undefined });
    onChange(parsed);
  }

  return (
    <Field label={<FieldLabel name={label} />} help={help} error={current.invalid ?? error} controlId={id}>
      <CodeEditor language="json" value={current.text} onChange={edit} minLines={2} maxLines={12} aria-label={ariaLabel} aria-invalid={!locked && current.held !== undefined} />
    </Field>
  );
}

const arrayOnly: Check = (v) => (Array.isArray(v) ? undefined : t('pl.meta.filterNotArray'));
const objectOnly: Check = (v) => (isObj(v) ? undefined : t('pl.meta.errorNotObject'));

export function MetaForm({ meta, onChange, info, issues, idPrefix, name, noDisable, offerErrorResponse }: MetaFormProps) {
  const locked = useLocked();
  const current = meta ?? {};
  const set = (key: string, v: unknown) => {
    const next = { ...current };
    if (v === undefined) delete next[key];
    else next[key] = v;
    onChange(Object.keys(next).length > 0 ? next : undefined);
  };

  const errorResponse = current.error_response;
  const offerError = offerErrorResponse === true || errorResponse !== undefined;
  // How error_response is written: follows the stored value, else the user's pick.
  const [pick, setPick] = useState<'text' | 'json'>(isObj(errorResponse) ? 'json' : 'text');
  const kind = isObj(errorResponse) ? 'json' : typeof errorResponse === 'string' ? 'text' : pick;
  const errorHeld = useHeld();
  const errorRef = useRef<HTMLDivElement>(null);
  /**
   * A switch converts what is there: text becomes {"message": text} (as the APISIX docs write it), and
   * back. It waits while the JSON holds text that is not emitted.
   */
  function switchKind(to: 'text' | 'json') {
    if (to === kind || errorHeld.refuse(errorRef.current)) return;
    setPick(to);
    if (to === 'json' && typeof errorResponse === 'string') set('error_response', { message: errorResponse });
    if (to === 'text' && isObj(errorResponse)) {
      set('error_response', typeof errorResponse.message === 'string' ? errorResponse.message : JSON.stringify(errorResponse));
    }
  }
  const others = Object.keys(current).filter((key) => !KNOWN.has(key) || (noDisable && key === 'disable'));
  const priority = typeof current.priority === 'number' ? current.priority : undefined;
  const id = (key: string) => `${idPrefix}-meta-${key}`;
  const fieldName = (key: string) => `${name}._meta.${key}`;

  return (
    <div className="pl-meta">
      <div className="pl-meta__grid">
        {!noDisable && (
          <Switch
            id={id('disable')}
            label={<FieldLabel name="disable" />}
            checked={current.disable === true}
            onLabel={t('pl.meta.disableOn')}
            offLabel={t('pl.meta.disableOff')}
            help={t('pl.meta.disableHelp')}
            error={issueAt(issues, 'disable')}
            onChange={(on) => set('disable', on ? true : undefined)}
          />
        )}
        <NumberInput
          id={id('priority')}
          label={<FieldLabel name="priority" />}
          fieldName={fieldName('priority')}
          integer
          value={priority}
          placeholder={info?.priority !== undefined ? t('pl.meta.priorityDefault', { priority: info.priority }) : undefined}
          help={t('pl.meta.priorityHelp')}
          error={issueAt(issues, 'priority')}
          onChange={(v) => set('priority', v)}
        />
      </div>
      <JsonValue
        id={id('filter')}
        fieldName={fieldName('filter')}
        value={current.filter}
        onChange={(v) => set('filter', v)}
        label="filter"
        ariaLabel={t('pl.meta.filterLabel')}
        help={t('pl.meta.filterHelp')}
        error={issueAt(issues, 'filter')}
        check={arrayOnly}
      />
      {offerError && (
        <div className="pl-meta__error" ref={errorRef}>
          {!locked && (
            <Select
              id={id('error-kind')}
              label={t('pl.meta.errorKind')}
              value={kind}
              options={[
                { value: 'text', label: t('pl.meta.errorText') },
                { value: 'json', label: t('pl.meta.errorJson') },
              ]}
              onChange={(v) => switchKind(v === 'json' ? 'json' : 'text')}
            />
          )}
          <PendingScope onChange={errorHeld.track}>
            {kind === 'json' ? (
              <JsonValue
                id={id('error_response')}
                fieldName={fieldName('error_response')}
                value={isObj(errorResponse) ? errorResponse : undefined}
                onChange={(v) => set('error_response', v)}
                label="error_response"
                ariaLabel={t('pl.meta.errorJsonLabel')}
                help={t('pl.meta.errorHelp')}
                error={issueAt(issues, 'error_response')}
                check={objectOnly}
              />
            ) : (
              <Textarea
                id={id('error_response')}
                label={<FieldLabel name="error_response" />}
                rows={2}
                value={typeof errorResponse === 'string' ? errorResponse : ''}
                help={t('pl.meta.errorHelp')}
                error={issueAt(issues, 'error_response')}
                onChange={(v) => set('error_response', v === '' ? undefined : v)}
              />
            )}
          </PendingScope>
        </div>
      )}
      {others.length > 0 && <p className="pl-note">{t('pl.meta.other', { keys: others.join(', ') })}</p>}
    </div>
  );
}
