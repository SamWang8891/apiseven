// The Plugins tab: one card per configured plugin (sorted by name, collapsed until opened), an
// "Add plugin" picker of what this APISIX has loaded, and the plugins inherited from elsewhere.
// It edits the whole `plugins` object: every change emits the complete next value, `{}` configs
// (a plugin on with its defaults) are kept as they are, and removing the last plugin emits
// undefined, or {} where APISIX requires `plugins`.
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FC } from 'react';
import { useAllPlugins } from '../api/hooks';
import { isObj } from '../api/sanitize';
import type { Obj } from '../api/types';
import { setPathRaw } from '../editor/draft';
import { issuesUnder, withinPath, type Issue } from '../editor/issues';
import { t } from '../i18n';
import type { TabProps } from '../resources/registry';
import { useLatest } from '../schema-form/context';
import { ErrorLine } from '../schema-form/fields/chrome';
import { Button, useLocked } from '../ui';
import { inheritedPlugins } from './inherited';
import { PluginCard } from './PluginCard';
import { PluginPicker } from './PluginPicker';
import { emptyPlugins, subsystemOf, type Scope } from './scope';
import './plugins.css';

export interface InheritedPlugin {
  name: string;
  from: 'service' | 'plugin_config';
  disabled: boolean;
}

export interface PluginsTabProps {
  value: Record<string, Obj> | undefined;
  onChange: (v: Record<string, Obj> | undefined) => void;
  scope: Scope;
  /** Issues whose path starts with `plugins.` (paths as in the draft: `plugins.<name>.<field>`). */
  issues?: Issue[];
  /** Plugins that also run here from other objects: listed read-only under the cards. */
  inherited?: InheritedPlugin[];
  /** Blocked Save attempts since editing began: each one opens the cards that have issues. */
  saveAttempts?: number;
}

const NO_ISSUES: Issue[] = [];
const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export const PluginsTab: FC<PluginsTabProps> = ({ value, onChange, scope, issues = NO_ISSUES, inherited, saveAttempts = 0 }) => {
  const locked = useLocked();
  const query = useAllPlugins(subsystemOf(scope));
  const all = query.data;
  const list = all ? 'loaded' : query.isError ? 'failed' : 'loading';
  const names = useMemo(() => Object.keys(value ?? {}).sort(byName), [value]);

  // Each card's issues, paths relative to its config; the rest (about `plugins` itself, or about a
  // plugin with no card) shows above the cards.
  const { perPlugin, stray } = useMemo(() => {
    const per = new Map<string, Issue[]>();
    for (const name of names) per.set(name, withinPath(issues, `plugins.${name}`));
    const placed = new Set(names.flatMap((name) => issuesUnder(issues, `plugins.${name}`)));
    return { perPlugin: per, stray: issues.filter((issue) => !placed.has(issue)) };
  }, [names, issues]);

  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [picking, setPicking] = useState(false);
  /** A card to bring into view once rendered (and focus, for one just added); a new object each time. */
  const [reveal, setReveal] = useState<{ name: string; focus: boolean }>();
  const cards = useRef(new Map<string, HTMLDivElement>());

  // A blocked Save opens every card that has issues (also when the tab mounts after one).
  const [seenAttempts, setSeenAttempts] = useState(0);
  if (saveAttempts !== seenAttempts) {
    setSeenAttempts(saveAttempts);
    const failing = names.filter((name) => (perPlugin.get(name)?.length ?? 0) > 0);
    if (saveAttempts > seenAttempts && failing.length > 0) {
      setOpen((prev) => new Set([...prev, ...failing]));
      setReveal({ name: failing[0] ?? '', focus: false });
    }
  }

  useEffect(() => {
    if (!reveal) return;
    const el = cards.current.get(reveal.name);
    el?.scrollIntoView?.({ block: 'nearest' });
    if (reveal.focus) el?.querySelector<HTMLButtonElement>('.pl-card__toggle')?.focus({ preventScroll: true });
  }, [reveal]);

  function add(name: string) {
    setPicking(false);
    onChange({ ...(value ?? {}), [name]: {} });
    setOpen((prev) => new Set(prev).add(name));
    setReveal({ name, focus: true });
  }

  // Stable per-name handlers for the memoised cards; each builds the next value from the latest one.
  const latest = useLatest({ value, onChange, scope });
  const change = useCallback(
    (name: string, conf: unknown) => {
      const { value: now, onChange: emit } = latest.current;
      emit({ ...(now ?? {}), [name]: conf as Obj });
    },
    [latest],
  );
  const remove = useCallback(
    (name: string) => {
      const { value: now, onChange: emit, scope: where } = latest.current;
      const rest = { ...(now ?? {}) };
      delete rest[name];
      emit(Object.keys(rest).length > 0 ? rest : emptyPlugins(where));
    },
    [latest],
  );
  const toggle = useCallback(
    (name: string) =>
      setOpen((prev) => {
        const next = new Set(prev);
        if (!next.delete(name)) next.add(name);
        return next;
      }),
    [],
  );
  const refs = useCallback((name: string, el: HTMLDivElement | null) => {
    if (el) cards.current.set(name, el);
    else cards.current.delete(name);
  }, []);

  // A credential holds one plugin (schema_def.lua: plugins maxProperties 1).
  const full = scope === 'credential' && names.length >= 1;
  const canAdd = !locked && !full;

  return (
    <div className="pl">
      {list === 'loading' && <p className="pl-note">{t('pl.loading')}</p>}
      {query.isError && (
        <p className="pl-note pl-note--warn" role="status">
          {t('pl.loadFailed', { error: query.error.message })}
        </p>
      )}
      {stray.length > 0 && (
        <div className="pl-alert" role="alert" aria-label={t('pl.issues')}>
          {stray.map((issue, i) => (
            <ErrorLine key={i} message={issue.path === 'plugins' ? issue.message : `${issue.path.replace(/^plugins\./, '')}: ${issue.message}`} />
          ))}
        </div>
      )}
      <div className="pl-bar">
        <p className="pl-bar__count">
          {names.length === 0 ? (locked ? t('pl.emptyLocked') : t('pl.empty')) : names.length === 1 ? t('pl.count.one') : t('pl.count.many', { count: names.length })}
        </p>
        {canAdd && (
          <Button variant={names.length === 0 ? 'primary' : 'secondary'} icon={<Plus size={15} />} disabled={!all} onClick={() => setPicking(true)}>
            {t('pl.add')}
          </Button>
        )}
      </div>
      {full && !locked && <p className="pl-note">{t('pl.credentialOne')}</p>}
      {names.length > 0 && (
        <div className="pl-list">
          {names.map((name) => (
            <PluginCard
              key={name}
              name={name}
              conf={value?.[name]}
              info={all?.[name]}
              list={list}
              scope={scope}
              issues={perPlugin.get(name) ?? NO_ISSUES}
              open={open.has(name)}
              onToggle={toggle}
              onChange={change}
              onRemove={remove}
              cardRef={refs}
            />
          ))}
        </div>
      )}
      {inherited && inherited.length > 0 && <Inherited rows={inherited} local={names} />}
      {picking && all && <PluginPicker open onClose={() => setPicking(false)} onPick={add} all={all} scope={scope} configured={names} />}
    </div>
  );
};

/** The plugins that run here from other objects, read-only; one configured here overrides its namesake. */
function Inherited({ rows, local }: { rows: InheritedPlugin[]; local: string[] }) {
  const titleId = useId();
  return (
    <section className="pl-inherited">
      <h3 id={titleId} className="pl-inherited__title">
        {t('pl.inherited.title')}
      </h3>
      <p className="pl-inherited__help">{t('pl.inherited.help')}</p>
      <ul className="pl-inherited__list" aria-labelledby={titleId}>
        {rows.map((row) => (
          <li key={`${row.from}:${row.name}`} className="pl-inherited__row">
            <span className="pl-inherited__name mono">{row.name}</span>
            <span className="pl-inherited__from">{row.from === 'service' ? t('pl.inherited.fromService') : t('pl.inherited.fromPluginConfig')}</span>
            {row.disabled && <span className="pl-inherited__tag">{t('pl.inherited.off')}</span>}
            {local.includes(row.name) && <span className="pl-inherited__tag pl-inherited__tag--over">{t('pl.inherited.overridden')}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** PluginsTab bound to an editor draft's `plugins` (what makePluginsTab renders). */
export function DraftPluginsTab({ draft, setDraft, issues, ctx, saveAttempts, scope }: TabProps & { scope: Scope }) {
  const value = isObj(draft.plugins) ? (draft.plugins as Record<string, Obj>) : undefined;
  return (
    <PluginsTab
      value={value}
      // Raw: `{}` (a plugin on with its defaults, or the empty list APISIX requires) is kept as it is.
      onChange={(next) => setDraft(setPathRaw(draft, ['plugins'], next))}
      scope={scope}
      issues={issues}
      inherited={scope === 'route' ? inheritedPlugins(draft, ctx) : undefined}
      saveAttempts={saveAttempts}
    />
  );
}
