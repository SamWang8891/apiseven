// The route editor's General tab: name, description, labels and priority, then the route at a
// glance: one line per other tab (what it matches, where it goes, its plugins, the rest), each
// linking to that tab. Locked, this is the spec sheet of the route.
import { useId, type ReactNode } from 'react';
import { isObj } from '../../api/sanitize';
import type { Obj } from '../../api/types';
import { setPath } from '../../editor/draft';
import { issueAt } from '../../editor/issues';
import { t } from '../../i18n';
import { Field, Input, KeyValueInput, NumberInput, useLocked } from '../../ui';
import { ReadOnlyValue } from '../../ui/ReadOnly';
import type { Ctx } from '../ctx';
import type { TabProps } from '../registry';
import { TabLink } from '../Overview';
import { effectivePlugins, routeHosts, routeScript } from '../resolve';
import { inheritLoading } from './inherit';
import { readPair } from './pairs';
import { targetOf } from '../upstreamSource';
import '../resources.css';
import './routes.css';

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

/** Mono values joined by commas, as one run of text. */
function Mono({ values }: { values: string[] }) {
  return <span className="mono">{values.join(', ')}</span>;
}

function Parts({ parts }: { parts: ReactNode[] }) {
  return (
    <span className="rt-overview__parts">
      {parts.map((part, i) => (
        <span key={i} className="rt-overview__part">
          {part}
        </span>
      ))}
    </span>
  );
}

function matching(draft: Obj, ctx: Ctx): ReactNode {
  const { hosts, viaService } = routeHosts(draft, ctx);
  const own = readPair(draft, 'host', 'hosts').length > 0;
  const waiting = !own && inheritLoading(draft, ctx).service;
  const uris = readPair(draft, 'uri', 'uris');
  const methods = Array.isArray(draft.methods) ? draft.methods.filter((m): m is string => typeof m === 'string') : [];
  const conditions = Array.isArray(draft.vars) ? draft.vars.length : 0;
  return (
    <Parts
      parts={[
        waiting ? (
          t('rt.overview.hostsLoading')
        ) : hosts.length > 0 ? (
          <>
            <Mono values={hosts} />
            {viaService && ` ${t('rt.overview.viaService')}`}
          </>
        ) : (
          t('rt.match.anyHost')
        ),
        uris.length > 0 ? <Mono values={uris} /> : t('ui.empty'),
        methods.length > 0 ? methods.join(', ') : t('rt.match.anyMethod'),
        ...(conditions > 0 ? [conditions === 1 ? t('rt.overview.conditionOne') : t('rt.overview.conditions', { count: conditions })] : []),
        ...(draft.remote_addr !== undefined || draft.remote_addrs !== undefined ? [<Mono key="addr" values={readPair(draft, 'remote_addr', 'remote_addrs')} />] : []),
      ]}
    />
  );
}

function upstream(draft: Obj, ctx: Ctx): ReactNode {
  const target = targetOf(draft, ctx);
  const label = target.viaService !== undefined ? `${target.label} ${t('rt.up.viaService', { name: target.viaService })}` : target.label;
  return <Parts parts={[label, ...(target.nodes.length > 0 ? [<Mono key="nodes" values={target.nodes} />] : [])]} />;
}

function plugins(draft: Obj, ctx: Ctx): ReactNode {
  // A script runs instead of every plugin: the route's own, or its service's (routeScript).
  const script = routeScript(draft, ctx);
  if (script === 'route') return t('rt.overview.script');
  if (script === 'service') return t('rt.overview.serviceScript');
  // Whether the service's script replaces these plugins isn't known yet, or at all: only that is said,
  // in the Plugins tab's words (the list says "loading…" / "unknown" too).
  if (script === 'loading') return t('rt.pl.serviceScriptLoading');
  if (script === 'unknown') return t('rt.pl.serviceScriptUnknown');
  const names = effectivePlugins(draft, ctx).map((p) => (p.disabled ? t('rt.overview.pluginOff', { name: p.name }) : p.name));
  // The plugin config's aren't known yet: show the route's and the service's, and say the rest is loading.
  if (inheritLoading(draft, ctx).pluginConfig) return <Parts parts={[...(names.length > 0 ? [<Mono key="own" values={names} />] : []), t('rt.overview.inheritedLoading')]} />;
  return names.length > 0 ? <Mono values={names} /> : t('rt.overview.noPlugins');
}

/** Each timeout that is set, and the ones that are not (APISIX refuses a partial timeout; the Advanced tab flags it). */
function timeouts(timeout: Obj): string {
  const list = (['connect', 'send', 'read'] as const).map((key) => {
    const name = t(`rt.overview.t.${key}`);
    const v = timeout[key];
    return typeof v === 'number' ? t('rt.overview.timeout', { name, value: v }) : t('rt.overview.timeoutMissing', { name });
  });
  return t('rt.overview.timeouts', { list: list.join(', ') });
}

function advanced(draft: Obj): ReactNode {
  const parts: string[] = [];
  const timeout = isObj(draft.timeout) ? draft.timeout : undefined;
  if (timeout) parts.push(timeouts(timeout));
  if (draft.enable_websocket === true) parts.push(t('rt.overview.websocketOn'));
  if (draft.enable_websocket === false) parts.push(t('rt.overview.websocketOff'));
  if (draft.filter_func !== undefined) parts.push(t('rt.overview.filter'));
  if (draft.script !== undefined) parts.push(t('rt.overview.script'));
  return parts.length > 0 ? <Parts parts={parts} /> : t('rt.overview.defaults');
}

function Overview({ draft, ctx }: { draft: Obj; ctx: Ctx }) {
  const id = useId();
  const rows: [tab: string, label: string, value: ReactNode][] = [
    ['matching', t('rt.tab.matching'), matching(draft, ctx)],
    ['upstream', t('rt.tab.upstream'), upstream(draft, ctx)],
    ['plugins', t('pl.tab'), plugins(draft, ctx)],
    ['advanced', t('rt.tab.advanced'), advanced(draft)],
  ];
  return (
    <section className="res-overview" aria-labelledby={id}>
      <h2 className="res-overview__title" id={id}>
        {t('rt.overview')}
      </h2>
      <dl className="res-overview__list">
        {rows.map(([tab, label, value]) => (
          <div key={tab} className="res-overview__row">
            <dt>
              <TabLink tab={tab}>{label}</TabLink>
            </dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function GeneralTab({ draft, setDraft, issues, ctx }: TabProps) {
  const locked = useLocked();
  // Labels with a value that isn't text can't be edited here; they are kept as they are.
  const labels = isObj(draft.labels) ? draft.labels : {};
  const textLabels = Object.fromEntries(Object.entries(labels).filter((e): e is [string, string] => typeof e[1] === 'string'));
  const otherLabels = Object.fromEntries(Object.entries(labels).filter(([, v]) => typeof v !== 'string'));
  const priority = num(draft.priority);
  return (
    <div className="ed-stack">
      <div className="ed-grid">
        <Input label={t('rt.general.name')} value={text(draft.name)} error={issueAt(issues, 'name')} onChange={(e) => setDraft(setPath(draft, ['name'], e.target.value))} />
        <Input label={t('rt.general.desc')} value={text(draft.desc)} error={issueAt(issues, 'desc')} onChange={(e) => setDraft(setPath(draft, ['desc'], e.target.value))} />
        {locked && priority === undefined ? (
          <Field label={t('rt.general.priority')} error={issueAt(issues, 'priority')}>
            <ReadOnlyValue>{t('rt.general.priorityDefault')}</ReadOnlyValue>
          </Field>
        ) : (
          <NumberInput
            label={t('rt.general.priority')}
            integer
            placeholder="0"
            value={priority}
            help={locked ? undefined : t('rt.general.priorityHelp')}
            error={issueAt(issues, 'priority')}
            onChange={(v) => setDraft(setPath(draft, ['priority'], v))}
          />
        )}
        <KeyValueInput
          label={t('rt.general.labels')}
          help={locked ? undefined : t('rt.general.labelsHelp')}
          mono
          value={textLabels}
          error={issueAt(issues, 'labels')}
          onChange={(map) => setDraft(setPath(draft, ['labels'], { ...otherLabels, ...map }))}
        />
      </div>
      <Overview draft={draft} ctx={ctx} />
    </div>
  );
}
