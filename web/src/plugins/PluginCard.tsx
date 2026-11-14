// One configured plugin: a header to scan (name, category, on/off, the config in one line, problems,
// docs, remove) that opens to the config as a form generated from the plugin's schema or as JSON,
// both over the same value, then the `_meta` options. Locked, it still opens; everything reads as text.
// A field that holds input it has not emitted (usePending) keeps what shows it on screen: the card,
// `_meta` and the Form/JSON view refuse to close or switch until it is fixed or cleared.
import { BookOpen, ChevronRight, Eye, EyeOff, Trash2 } from 'lucide-react';
import { memo, useCallback, useId, useMemo, useRef, useState } from 'react';
import { isObj } from '../api/sanitize';
import type { Obj, PluginInfo } from '../api/types';
import { deepEqual } from '../editor/draft';
import { withinPath, type Issue } from '../editor/issues';
import { t } from '../i18n';
import { ErrorLine } from '../schema-form/fields/chrome';
import { redactSecrets } from '../schema-form/model';
import { SchemaForm } from '../schema-form/SchemaForm';
import { Button, CodeEditor, PendingScope, Switch, useHeld, useLocked, usePending } from '../ui';
import { catalog } from './catalog';
import { MetaForm } from './MetaForm';
import { formSchemaOf, isDisabled, META, metaOf, setDisabled, withMeta, withoutMeta } from './meta';
import { schemaFor, type Scope } from './scope';
import { pluginSummary } from './summary';

export interface PluginCardProps {
  name: string;
  /** The plugin's config as stored (normally an object; anything else is shown and kept as JSON). */
  conf: unknown;
  /** The plugin as this APISIX publishes it; undefined while the list loads, or when it is not loaded there. */
  info: PluginInfo | undefined;
  /** The plugin list: once 'loaded', a missing `info` means the plugin is not loaded on this APISIX. */
  list: 'loading' | 'loaded' | 'failed';
  scope: Scope;
  /** This plugin's issues, paths relative to its config ('' = the config as a whole). */
  issues: Issue[];
  open: boolean;
  /** These take the plugin's name, so one stable function serves every card (cards are memoised). */
  onToggle: (name: string) => void;
  onChange: (name: string, conf: unknown) => void;
  onRemove: (name: string) => void;
  /** Called with the card's element (null on unmount), to scroll it into view. */
  cardRef?: (name: string, el: HTMLDivElement | null) => void;
}

const docsUrl = (name: string): string => `https://apisix.apache.org/docs/apisix/plugins/${catalog[name]?.doc ?? name}/`;

const categoryLabel = (name: string): string => t(`pl.category.${catalog[name]?.category ?? 'other'}`);

const isMetaPath = (path: string): boolean => path === META || path.startsWith(`${META}.`);

/** The schema's own top-level encrypt_fields (secrets to mask outside the form). */
function encryptOf(schema: Obj | undefined): string[] {
  const list: unknown = schema?.encrypt_fields;
  return Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string') : [];
}

/** Props equal, `issues` by content: the tab rebuilds every card's list on each change. */
const sameCard = (a: PluginCardProps, b: PluginCardProps): boolean =>
  (Object.keys(a) as (keyof PluginCardProps)[]).every((key) => key === 'issues' || Object.is(a[key], b[key])) &&
  Object.keys(a).length === Object.keys(b).length &&
  JSON.stringify(a.issues) === JSON.stringify(b.issues);

export const PluginCard = memo(function PluginCard({ name, conf, info, list, scope, issues, open, onToggle, onChange: emit, onRemove, cardRef }: PluginCardProps) {
  const locked = useLocked();
  const onChange = useCallback((next: unknown) => emit(name, next), [emit, name]);
  const ref = useCallback((el: HTMLDivElement | null) => cardRef?.(name, el), [cardRef, name]);
  const held = useHeld();
  const bodyRef = useRef<HTMLDivElement>(null);
  const ids = useId();
  const nameId = `${ids}-name`;
  const bodyId = `${ids}-body`;
  const schema = info ? schemaFor(info, scope) : undefined;
  const encrypt = useMemo(() => encryptOf(schema), [schema]);
  const config = isObj(conf) ? conf : undefined;
  const off = isDisabled(conf);
  // Until the plugin list says which fields are secret, there is no summary to leak one.
  const summary = list === 'loading' ? '' : config ? pluginSummary(name, config, encrypt) : (JSON.stringify(conf) ?? '');
  const problems = issues.length;

  return (
    <div ref={ref} role="group" aria-labelledby={nameId} className={['pl-card', open && 'pl-card--open', off && 'pl-card--off', problems > 0 && 'pl-card--error'].filter(Boolean).join(' ')}>
      <div className="pl-card__head">
        <button
          type="button"
          className="pl-card__toggle"
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          aria-labelledby={nameId}
          aria-describedby={`${ids}-sum ${ids}-cat`}
          onClick={() => {
            if (!(open && held.refuse(bodyRef.current))) onToggle(name);
          }}
        >
          <ChevronRight className="pl-card__chevron" size={14} aria-hidden="true" />
          <span id={nameId} className="pl-card__name mono">
            {name}
          </span>
          <span id={`${ids}-sum`} className="pl-card__summary mono" title={summary}>
            {summary}
          </span>
          <span id={`${ids}-cat`} className="pl-card__cat">
            {categoryLabel(name)}
          </span>
        </button>
        <div className="pl-card__tools">
          {problems > 0 && (
            <span className="pl-card__problems">{problems === 1 ? t('pl.card.problems.one') : t('pl.card.problems.many', { count: problems })}</span>
          )}
          {config && (
            <Switch
              aria-label={t('pl.card.enable', { name })}
              checked={!off}
              onChange={(on) => onChange(setDisabled(config, !on))}
            />
          )}
          {catalog[name] && (
            <a className="pl-card__docs" href={docsUrl(name)} target="_blank" rel="noreferrer" aria-label={t('pl.card.docs', { name })} title={t('pl.card.docs', { name })}>
              <BookOpen size={15} aria-hidden="true" />
            </a>
          )}
          {!locked && <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} aria-label={t('pl.card.remove', { name })} onClick={() => onRemove(name)} />}
        </div>
      </div>
      {open && (
        <div id={bodyId} ref={bodyRef} className="pl-card__body">
          <PendingScope onChange={held.track}>
            <CardBody name={name} conf={conf} info={info} list={list} schema={schema} encrypt={encrypt} issues={issues} onChange={onChange} />
          </PendingScope>
        </div>
      )}
    </div>
  );
}, sameCard);

function CardBody({ name, conf, info, list, schema, encrypt, issues, onChange }: {
  name: string;
  conf: unknown;
  info: PluginInfo | undefined;
  list: PluginCardProps['list'];
  schema: Obj | undefined;
  encrypt: string[];
  issues: Issue[];
  onChange: (conf: unknown) => void;
}) {
  const [view, setView] = useState<'form' | 'json'>('form');
  // Open from the start when it holds a problem (a card opens itself when Save finds one).
  const [metaOpen, setMetaOpen] = useState(() => issues.some((issue) => isMetaPath(issue.path)));
  const ids = useId();
  const viewHeld = useHeld();
  const viewRef = useRef<HTMLDivElement>(null);
  const metaHeld = useHeld();
  const metaRef = useRef<HTMLDivElement>(null);
  const config = isObj(conf) ? conf : undefined;
  const meta = metaOf(conf);
  const hasForm = schema !== undefined;
  const shown = hasForm ? view : 'json';

  const rootIssues = issues.filter((issue) => issue.path === '');
  const metaIssues = useMemo(() => withinPath(issues, META), [issues]);
  const fieldIssues = useMemo(() => issues.filter((issue) => issue.path !== '' && !isMetaPath(issue.path)), [issues]);
  const formSchema = useMemo(() => (schema ? formSchemaOf(schema) : undefined), [schema]);
  const formValue = useMemo(() => (config ? withoutMeta(config) : conf), [config, conf]);
  const metaKeys = Object.keys(meta ?? {});

  return (
    <>
      {rootIssues.length > 0 && (
        <div className="pl-card__alert" role="alert">
          {rootIssues.map((issue, i) => (
            <ErrorLine key={i} message={issue.message} />
          ))}
        </div>
      )}
      {!hasForm && list !== 'failed' && <p className="pl-note">{list === 'loaded' ? t('pl.card.noForm', { name }) : t('pl.card.formLoading')}</p>}
      {hasForm && (
        <div className="pl-views" role="group" aria-label={t('pl.card.view', { name })}>
          {(['form', 'json'] as const).map((v) => (
            <button
              key={v}
              type="button"
              className="pl-views__btn"
              aria-pressed={shown === v}
              onClick={() => {
                if (v !== shown && !viewHeld.refuse(viewRef.current)) setView(v);
              }}
            >
              {v === 'form' ? t('pl.card.form') : t('pl.card.json')}
            </button>
          ))}
        </div>
      )}
      <div ref={viewRef} className="pl-view">
        <PendingScope onChange={viewHeld.track}>
          {shown === 'form' && formSchema ? (
            <SchemaForm
              schema={formSchema}
              value={formValue}
              onChange={(v) => onChange(isObj(v) ? withMeta(v, metaOf(conf)) : v)}
              errors={fieldIssues}
              idPrefix={`pl-${name}`}
              name={name}
            />
          ) : (
            <ConfigJson name={name} conf={conf} schema={schema} encrypt={encrypt} issues={issues.filter((issue) => issue.path !== '')} onChange={onChange} />
          )}
        </PendingScope>
      </div>
      {config && (
        <section className={metaOpen ? 'pl-metabox pl-metabox--open' : 'pl-metabox'}>
          <button
            type="button"
            className="pl-metabox__toggle"
            aria-expanded={metaOpen}
            aria-controls={metaOpen ? `${ids}-meta` : undefined}
            onClick={() => {
              if (!(metaOpen && metaHeld.refuse(metaRef.current))) setMetaOpen((o) => !o);
            }}
          >
            <ChevronRight className="pl-card__chevron" size={14} aria-hidden="true" />
            <span className="pl-metabox__title">{t('pl.meta.title')}</span>{' '}
            <span className="pl-metabox__keys mono">{metaKeys.length > 0 ? t('pl.meta.set', { keys: metaKeys.join(', ') }) : t('pl.meta.none')}</span>
            {metaIssues.length > 0 && <span className="pl-card__problems">{metaIssues.length}</span>}
          </button>
          {metaOpen && (
            <div id={`${ids}-meta`} ref={metaRef} className="pl-metabox__body">
              <PendingScope onChange={metaHeld.track}>
                <MetaForm meta={meta} onChange={(m) => onChange(withMeta(config, m))} info={info} issues={metaIssues} idPrefix={`pl-${name}`} name={name} />
              </PendingScope>
            </div>
          )}
        </section>
      )}
    </>
  );
}

const pretty = (v: unknown): string => JSON.stringify(v, null, 2) ?? '';

/** Whether `text` already says `value` (so the value coming back from a JSON edit keeps what was typed). */
function says(text: string, value: unknown): boolean {
  try {
    return deepEqual(JSON.parse(text), value);
  } catch {
    return false;
  }
}

/** The config as JSON (`_meta` included), linted against the plugin's schema. Locked, secrets are masked behind a reveal. */
function ConfigJson({ name, conf, schema, encrypt, issues, onChange }: {
  name: string;
  conf: unknown;
  schema: Obj | undefined;
  encrypt: string[];
  issues: Issue[];
  onChange: (conf: unknown) => void;
}) {
  const locked = useLocked();
  /** `error` (shown) and `held` (for Save) are set while the text is not emitted. */
  const [state, setState] = useState(() => ({ text: pretty(conf), synced: conf, error: undefined as string | undefined, held: undefined as string | undefined }));
  const [revealed, setRevealed] = useState(false);
  let current = state;
  if (!Object.is(conf, state.synced)) {
    current = says(state.text, conf) ? { ...state, synced: conf } : { text: pretty(conf), synced: conf, error: undefined, held: undefined };
    setState(current);
  }
  const hidden = useMemo(() => (locked ? redactSecrets(conf, '', encrypt) : undefined), [locked, conf, encrypt]);
  usePending(locked ? undefined : current.held);

  function change(text: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      const error = t('pl.card.jsonInvalid', { error: e instanceof Error ? e.message : String(e) });
      setState((s) => ({ ...s, text, error, held: t('ui.pending.json', { field: name }) }));
      return;
    }
    if (!isObj(parsed)) {
      setState((s) => ({ ...s, text, error: t('pl.card.notObject'), held: t('ui.pending.jsonType', { field: name, type: 'object' }) }));
      return;
    }
    setState({ text, synced: parsed, error: undefined, held: undefined });
    onChange(parsed);
  }

  // Locked: the stored value (never text typed before the lock), its secrets masked until revealed.
  const text = locked ? pretty(hidden?.redacted && !revealed ? hidden.value : conf) : current.text;
  return (
    <div className="pl-json">
      {locked && hidden?.redacted && (
        <div className="pl-json__bar">
          <Button size="sm" variant="ghost" icon={revealed ? <EyeOff size={13} /> : <Eye size={13} />} aria-pressed={revealed} onClick={() => setRevealed((r) => !r)}>
            {revealed ? t('pl.card.secrets.hide') : t('pl.card.secrets.show')}
          </Button>
        </div>
      )}
      <CodeEditor
        language="json"
        jsonSchema={schema}
        value={text}
        onChange={change}
        minLines={4}
        maxLines={24}
        aria-label={t('pl.card.jsonLabel', { name })}
        aria-invalid={!locked && current.held !== undefined}
      />
      <div aria-live="polite">{!locked && current.error !== undefined && <p className="pl-json__error mono">{current.error}</p>}</div>
      {issues.length > 0 && (
        <ul className="pl-json__issues">
          {issues.map((issue, i) => (
            <li key={i}>
              <code className="mono">{issue.path}</code> {issue.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
