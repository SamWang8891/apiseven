// One configured plugin: a header to scan (name, category, on/off, the config in one line, problems,
// docs, remove) that opens to the config as a form generated from the plugin's schema or as JSON,
// both over the same value, then the `_meta` options. Locked, it still opens; everything reads as text.
// A field that holds input it has not emitted (usePending) keeps what shows it on screen: the card,
// `_meta` and the Form/JSON view refuse to close or switch until it is fixed or cleared.
import { BookOpen, ChevronRight, Trash2 } from 'lucide-react';
import { memo, useCallback, useId, useMemo, useRef, useState } from 'react';
import { isObj } from '../api/sanitize';
import type { Obj, PluginInfo } from '../api/types';
import { withinPath, type Issue } from '../editor/issues';
import { t } from '../i18n';
import { ErrorLine } from '../schema-form/fields/chrome';
import { SchemaForm } from '../schema-form/SchemaForm';
import { Button, LockProvider, PendingScope, Switch, useHeld, useLocked, type PendingEntry } from '../ui';
import { catalog } from './catalog';
import { ConfigJson } from './ConfigJson';
import { MetaForm } from './MetaForm';
import { signInOf, signInRole } from './auth';
import { formSchemaOf, isDisabled, META, metaOf, setDisabled, withMeta, withoutMeta } from './meta';
import { schemaFor, type Scope } from './scope';
import { runOptionsNote, signInBadge, signInNote } from './signInText';
import { pluginSummary } from './summary';
import { configErrors } from './validate';

export interface PluginCardProps {
  name: string;
  /** The plugin's config as stored (normally an object; anything else is shown and kept as JSON). */
  conf: unknown;
  /** Its config in the object as the editor last loaded it from APISIX (undefined: new here): what "the stored value" of a secret field is. */
  stored?: unknown;
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

export const PluginCard = memo(function PluginCard({ name, conf, stored, info, list, scope, issues, open, onToggle, onChange: emit, onRemove, cardRef }: PluginCardProps) {
  const locked = useLocked();
  const onChange = useCallback((next: unknown) => emit(name, next), [emit, name]);
  const ref = useCallback((el: HTMLDivElement | null) => cardRef?.(name, el), [cardRef, name]);
  const held = useHeld();
  const bodyRef = useRef<HTMLDivElement>(null);
  /** The JSON view holds text: the config it says is not the stored one, so nothing else may change it. */
  const jsonHeld = useRef(false);
  const onJsonHeld = useCallback((h: boolean) => {
    jsonHeld.current = h;
  }, []);
  const ids = useId();
  const nameId = `${ids}-name`;
  const bodyId = `${ids}-body`;
  const schema = info ? schemaFor(info, scope) : undefined;
  const encrypt = useMemo(() => encryptOf(schema), [schema]);
  const config = isObj(conf) ? conf : undefined;
  const off = isDisabled(conf);
  // A consumer's or credential's auth plugin: APISIX ignores its `_meta.disable` (plugins/auth.ts), so
  // it has no switch, and a stored "off" is shown as what it is (signInOf). One the loaded list
  // doesn't know is not used at all; one that can't be classified yet gets no switch and no claim.
  const role = signInRole(scope, name, info, list === 'loaded');
  const signIn = useMemo(() => (role === 'signIn' ? signInOf(name, conf) : undefined), [role, name, conf]);
  const badge = signIn ? signInBadge(name, signIn.state) : role === 'unused' ? signInBadge(name, 'unused') : undefined;
  const note = signIn ? signInNote(name, signIn) : role === 'unused' ? t('pl.card.signIn.unusedNote', { name }) : undefined;
  const runNote = role === 'signIn' && (scope === 'consumer' || scope === 'credential') ? runOptionsNote(scope, name) : undefined;
  // Until the plugin list says which fields are secret, there is no summary to leak one; a plugin
  // this APISIX does not know shows none either (any of its values may be a secret).
  const summary = list === 'loading' || !info ? '' : config ? pluginSummary(name, config, encrypt) : (JSON.stringify(conf) ?? '');
  const problems = issues.length;
  // APISIX doesn't check a switched-off plugin's settings (validatePlugins); say what it would refuse.
  const unchecked = useMemo(() => (off && info ? configErrors(conf, info, scope) : []), [off, info, conf, scope]);

  return (
    <div ref={ref} role="group" aria-labelledby={nameId} className={['pl-card', open && 'pl-card--open', off && !role && 'pl-card--off', problems > 0 && 'pl-card--error'].filter(Boolean).join(' ')}>
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
          {config && badge && (
            <span className={badge.className} title={note}>
              {badge.label}
            </span>
          )}
          {config && !role && (
            <Switch
              aria-label={t('pl.card.enable', { name })}
              checked={!off}
              onChange={(on) => {
                if (!(jsonHeld.current && held.refuse(bodyRef.current))) onChange(setDisabled(config, !on));
              }}
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
            <CardBody
              name={name}
              conf={conf}
              stored={stored}
              info={info}
              list={list}
              schema={schema}
              encrypt={encrypt}
              issues={issues}
              note={note}
              danger={signIn?.state === 'stillSignsIn'}
              runNote={runNote}
              switchless={role !== undefined}
              unchecked={unchecked}
              onChange={onChange}
              onJsonHeld={onJsonHeld}
            />
          </PendingScope>
        </div>
      )}
    </div>
  );
}, sameCard);

function CardBody({ name, conf, stored, info, list, schema, encrypt, issues, note, danger, runNote, switchless, unchecked, onChange, onJsonHeld }: {
  name: string;
  conf: unknown;
  stored: unknown;
  info: PluginInfo | undefined;
  list: PluginCardProps['list'];
  schema: Obj | undefined;
  encrypt: string[];
  issues: Issue[];
  /** A consumer's or credential's auth plugin: what it is used for and how to revoke it (signInText). */
  note: string | undefined;
  /** Whether the note is a danger one (marked off, yet still signing in). */
  danger: boolean;
  /** What the run options do for such a plugin. */
  runNote: string | undefined;
  /** No on/off switch (signInRole): the unchecked note speaks of the mark, and the run options have no disable. */
  switchless: boolean;
  /** What APISIX would refuse in this switched-off plugin's settings once it is switched on. */
  unchecked: { path: string; message: string }[];
  onChange: (conf: unknown) => void;
  /** Whether the JSON view holds text (the card's own switch waits meanwhile). */
  onJsonHeld: (held: boolean) => void;
}) {
  const locked = useLocked();
  const [view, setView] = useState<'form' | 'json'>('form');
  // Open from the start when it holds a problem (a card opens itself when Save finds one).
  const [metaOpen, setMetaOpen] = useState(() => issues.some((issue) => isMetaPath(issue.path)));
  const ids = useId();
  const viewHeld = useHeld();
  const viewRef = useRef<HTMLDivElement>(null);
  const metaHeld = useHeld();
  const metaRef = useRef<HTMLDivElement>(null);
  // The JSON view and `_meta` both edit `_meta`, so while one of them holds input the other is
  // read-only: a change made in one would be undone when the other's text is fixed. Which one waits
  // is decided by who held first. A part goes read-only only while it holds nothing itself, and
  // can't start holding while read-only, so becoming read-only never drops a held entry (the rule:
  // a held entry goes only when its text is fixed or cleared, or a discard is confirmed).
  const [jsonHeld, setJsonHeld] = useState(false);
  const jsonHeldChange = useCallback(
    (h: boolean) => {
      setJsonHeld(h);
      onJsonHeld(h);
    },
    [onJsonHeld],
  );
  const [metaHolds, setMetaHolds] = useState(false);
  const metaTrack = useCallback(
    (entries: PendingEntry[]) => {
      metaHeld.track(entries);
      setMetaHolds(entries.length > 0);
    },
    [metaHeld],
  );
  const jsonWaits = metaHolds && !jsonHeld;
  const metaWaits = jsonHeld && !metaHolds;
  const config = isObj(conf) ? conf : undefined;
  const meta = metaOf(conf);
  const hasForm = schema !== undefined;
  const shown = hasForm ? view : 'json';

  const rootIssues = issues.filter((issue) => issue.path === '');
  const metaIssues = useMemo(() => withinPath(issues, META), [issues]);
  const fieldIssues = useMemo(() => issues.filter((issue) => issue.path !== '' && !isMetaPath(issue.path)), [issues]);
  const formSchema = useMemo(() => (schema ? formSchemaOf(schema) : undefined), [schema]);
  const formValue = useMemo(() => (config ? withoutMeta(config) : conf), [config, conf]);
  const baseline = useMemo(() => (isObj(stored) ? withoutMeta(stored) : undefined), [stored]);
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
      {note && (
        <p className={danger ? 'pl-note pl-note--danger' : 'pl-note pl-note--warn'} role="note">
          {note}
        </p>
      )}
      {unchecked.length > 0 && (
        <p className="pl-note" role="note">
          {/* A sign-in card has no switch: say "marked off", not "switched off". */}
          {t(switchless ? 'pl.card.uncheckedSignIn' : 'pl.card.unchecked', {
            first: unchecked[0]?.path ? `${unchecked[0].path}: ${unchecked[0].message}` : (unchecked[0]?.message ?? ''),
            count: unchecked.length,
          })}
        </p>
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
              baseline={baseline}
            />
          ) : (
            <>
              {jsonWaits && !locked && <p className="pl-note">{t('pl.card.heldByMeta')}</p>}
              <LockProvider locked={locked || jsonWaits}>
                <ConfigJson
                  name={name}
                  conf={conf}
                  schema={schema}
                  encrypt={encrypt}
                  issues={issues.filter((issue) => issue.path !== '')}
                  onChange={onChange}
                  onHeld={jsonHeldChange}
                />
              </LockProvider>
            </>
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
              {metaWaits && !locked && <p className="pl-note">{t('pl.meta.heldByJson')}</p>}
              {runNote && (
                <p className="pl-note" role="note">
                  {runNote}
                </p>
              )}
              <PendingScope onChange={metaTrack}>
                <LockProvider locked={locked || metaWaits}>
                  <MetaForm meta={meta} onChange={(m) => onChange(withMeta(config, m))} info={info} issues={metaIssues} idPrefix={`pl-${name}`} name={name} noDisable={switchless} />
                </LockProvider>
              </PendingScope>
            </div>
          )}
        </section>
      )}
    </>
  );
}
