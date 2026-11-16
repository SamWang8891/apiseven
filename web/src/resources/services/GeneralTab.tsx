// The service editor's General tab: name, description, labels, the hosts its routes inherit and
// WebSocket, then the service at a glance (its upstream, plugins and the routes using it), each line
// linking to its tab. Locked, this is the service's spec sheet.
import { isObj } from '../../api/sanitize';
import type { Obj } from '../../api/types';
import { setPath } from '../../editor/draft';
import { issueAt, issuesUnder } from '../../editor/issues';
import { t } from '../../i18n';
import { Field, Input, KeyValueInput, Switch, TagInput, useLocked } from '../../ui';
import { ReadOnlyValue } from '../../ui/ReadOnly';
import type { Ctx } from '../ctx';
import { Mono, Overview, Parts } from '../Overview';
import type { TabProps } from '../registry';
import { hostProblem } from '../routes/validate';
import { targetOf } from '../upstreamSource';
import { pluginName } from '../pluginName';
import { servicePlugins } from './columns';

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const idOf = (v: unknown): string | undefined => (typeof v === 'number' ? String(v) : typeof v === 'string' && v !== '' ? v : undefined);

function upstream(draft: Obj, ctx: Ctx) {
  const target = targetOf(draft, ctx);
  if (target.none) return t('svc.up.resolvesNone');
  return <Parts parts={[target.label, ...(target.nodes.length > 0 ? [<Mono key="nodes" values={target.nodes} />] : [])]} />;
}

function plugins(draft: Obj) {
  const names = servicePlugins(draft).map(pluginName);
  const parts = [...(names.length > 0 ? [<Mono key="own" values={names} />] : [t('svc.overview.noPlugins')])];
  // A service's script is inherited by its routes and runs instead of their plugins (merge_service_route, apisix/init.lua).
  if (draft.script !== undefined) parts.push(t('svc.overview.script'));
  return <Parts parts={parts} />;
}

/**
 * How many routes and stream routes use the service; "loading…" until both lists have loaded (with
 * stream mode off, the stream routes count as loaded: there are none, Ctx).
 */
function routesLine(id: string | undefined, ctx: Ctx) {
  if (id === undefined) return t('svc.overview.noRoutes');
  const uses = (value: Obj) => idOf(value.service_id) === id;
  const routes = ctx.loaded.routes ? ctx.routes.filter((r) => uses(r.value)).length : undefined;
  const streams = ctx.loaded.streamRoutes ? ctx.streamRoutes.filter((r) => uses(r.value)).length : undefined;
  if (routes === undefined || streams === undefined) return t('picker.loading');
  if (routes === 0 && streams === 0) return t('svc.overview.noRoutes');
  const parts = [
    ...(routes === 0 ? [] : [routes === 1 ? t('svc.overview.routeOne') : t('svc.overview.routeCount', { count: routes })]),
    ...(streams === 0 ? [] : [streams === 1 ? t('svc.overview.streamOne') : t('svc.overview.streamCount', { count: streams })]),
  ];
  return <Parts parts={parts} />;
}

export function GeneralTab({ draft, setDraft, issues, ctx, isNew, original }: TabProps) {
  const locked = useLocked();
  // Labels with a value that isn't text can't be edited here; they are kept as they are.
  const labels = isObj(draft.labels) ? draft.labels : {};
  const textLabels = Object.fromEntries(Object.entries(labels).filter((e): e is [string, string] => typeof e[1] === 'string'));
  const otherLabels = Object.fromEntries(Object.entries(labels).filter(([, v]) => typeof v !== 'string'));
  const hosts = Array.isArray(draft.hosts) ? draft.hosts.filter((h): h is string => typeof h === 'string') : [];
  const hostsError = issuesUnder(issues, 'hosts')[0]?.message;
  // Unset and false both leave WebSocket off for a route that doesn't set it (apisix/init.lua 1046):
  // off removes the key, or gives back the false that was stored.
  const wsOff = original?.value.enable_websocket === false ? false : undefined;
  const routes = routesLine(isNew ? undefined : (original?.id ?? idOf(draft.id)), ctx);

  return (
    <div className="ed-stack">
      <div className="ed-grid">
        <Input label={t('svc.general.name')} value={text(draft.name)} error={issueAt(issues, 'name')} onChange={(e) => setDraft(setPath(draft, ['name'], e.target.value))} />
        <Input label={t('svc.general.desc')} value={text(draft.desc)} error={issueAt(issues, 'desc')} onChange={(e) => setDraft(setPath(draft, ['desc'], e.target.value))} />
        {locked && hosts.length === 0 ? (
          <Field label={t('svc.general.hosts')} error={hostsError}>
            <ReadOnlyValue>{t('svc.general.noHosts')}</ReadOnlyValue>
          </Field>
        ) : (
          <TagInput
            label={t('svc.general.hosts')}
            mono
            help={locked ? undefined : t('svc.general.hostsHelp')}
            error={hostsError}
            value={hosts}
            validate={hostProblem}
            onChange={(next) => setDraft(setPath(draft, ['hosts'], next))}
          />
        )}
        <Switch
          label={t('svc.general.websocket')}
          help={locked ? undefined : t('svc.general.wsHelp')}
          checked={draft.enable_websocket === true}
          error={issueAt(issues, 'enable_websocket')}
          onChange={(on) => setDraft(setPath(draft, ['enable_websocket'], on ? true : wsOff))}
        />
        <div className="ed-wide">
          <KeyValueInput
            label={t('svc.general.labels')}
            help={locked ? undefined : t('svc.general.labelsHelp')}
            mono
            value={textLabels}
            error={issueAt(issues, 'labels')}
            onChange={(map) => setDraft(setPath(draft, ['labels'], { ...otherLabels, ...map }))}
          />
        </div>
      </div>
      <Overview
        title={t('svc.overview')}
        rows={[
          { tab: 'upstream', label: t('rt.tab.upstream'), value: upstream(draft, ctx) },
          { tab: 'plugins', label: t('pl.tab'), value: plugins(draft) },
          { tab: 'routes', label: t('svc.tab.routes'), value: routes },
        ]}
      />
    </div>
  );
}
