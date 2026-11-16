// The stream route editor's General tab: name, description and labels, then the route at a glance
// (what it matches, where its connections go, its plugins and the rest), each line linking to its
// tab. Locked, this is the stream route's spec sheet.
import type { ReactNode } from 'react';
import { isObj } from '../../api/sanitize';
import type { Obj } from '../../api/types';
import { setPath } from '../../editor/draft';
import { issueAt } from '../../editor/issues';
import { t } from '../../i18n';
import { Input, KeyValueInput, useLocked } from '../../ui';
import type { Ctx } from '../ctx';
import { Mono, Overview, Parts } from '../Overview';
import type { TabProps } from '../registry';
import { asStreamRoute, streamEffectivePlugins } from '../resolve';
import { inheritLoading } from '../routes/inherit';
import { targetOf } from '../upstreamSource';
import { pluginName } from '../pluginName';
import { snisOf } from './columns';

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * `addr:port`, `[v6]:port`, the address alone, or "port N", the values in mono. A range
 * (`10.0.0.0/8`, `fe80::/64`) is no address a port can be joined to: "10.0.0.0/8 port 9100".
 */
function serverOf(draft: Obj): ReactNode {
  const addr = typeof draft.server_addr === 'string' && draft.server_addr !== '' ? draft.server_addr : undefined;
  const port = typeof draft.server_port === 'number' ? draft.server_port : undefined;
  if (addr !== undefined && port !== undefined && addr.includes('/')) {
    return (
      <>
        <Mono values={[addr]} /> {t('sr.overview.port')} <Mono values={[String(port)]} />
      </>
    );
  }
  if (addr !== undefined && port !== undefined) return <Mono values={[`${addr.includes(':') ? `[${addr}]` : addr}:${port}`]} />;
  if (addr !== undefined) return <Mono values={[addr]} />;
  return port !== undefined ? (
    <>
      {t('sr.overview.port')} <Mono values={[String(port)]} />
    </>
  ) : undefined;
}

function matching(draft: Obj): ReactNode {
  const server = serverOf(draft);
  const client = typeof draft.remote_addr === 'string' && draft.remote_addr !== '' ? draft.remote_addr : undefined;
  const snis = snisOf(draft);
  const parts: ReactNode[] = [
    ...(server !== undefined ? [<span key="server">{server}</span>] : []),
    ...(client !== undefined ? [<span key="client">{t('sr.overview.from')} <Mono values={[client]} /></span>] : []),
    ...(snis.length > 0 ? [<span key="sni">{t('sr.overview.sni')} <Mono values={snis} /></span>] : []),
  ];
  return parts.length > 0 ? <Parts parts={parts} /> : t('sr.overview.anyConnection');
}

function upstream(draft: Obj, ctx: Ctx): ReactNode {
  const target = targetOf(draft, ctx, 'stream');
  const label = target.viaService !== undefined ? `${target.label} ${t('rt.up.viaService', { name: target.viaService })}` : target.label;
  return <Parts parts={[label, ...(target.nodes.length > 0 ? [<Mono key="nodes" values={target.nodes} />] : [])]} />;
}

/**
 * The plugins that run for the stream route (streamEffectivePlugins, as the list's column): its own,
 * then what it takes from its service. Until a service it merges with has loaded, that part says so.
 */
function plugins(draft: Obj, ctx: Ctx): ReactNode {
  const label = pluginName;
  const all = streamEffectivePlugins(draft, ctx);
  const own = all.filter((p) => p.from === 'route').map(label);
  const ownPart = own.length > 0 ? [<Mono key="own" values={own} />] : [];
  if (inheritLoading(asStreamRoute(draft), ctx).service) return <Parts parts={[...ownPart, t('rt.overview.inheritedLoading')]} />;
  const inherited = all.filter((p) => p.from === 'service').map(label);
  const parts = [
    ...ownPart,
    ...(inherited.length > 0 ? [<span key="inherited"><Mono values={inherited} /> {t('rt.overview.viaService')}</span>] : []),
  ];
  return parts.length > 0 ? <Parts parts={parts} /> : t('rt.overview.noPlugins');
}

function advanced(draft: Obj): ReactNode {
  const parts: string[] = [];
  if (isObj(draft.protocol)) parts.push(t('sr.overview.protocol', { name: text(draft.protocol.name) || t('sr.adv.protocolUnnamed') }));
  if (draft.tls_passthrough === true) parts.push(t('sr.overview.passthrough'));
  return parts.length > 0 ? <Parts parts={parts} /> : t('rt.overview.defaults');
}

export function GeneralTab({ draft, setDraft, issues, ctx }: TabProps) {
  const locked = useLocked();
  // Labels with a value that isn't text can't be edited here; they are kept as they are.
  const labels = isObj(draft.labels) ? draft.labels : {};
  const textLabels = Object.fromEntries(Object.entries(labels).filter((e): e is [string, string] => typeof e[1] === 'string'));
  const otherLabels = Object.fromEntries(Object.entries(labels).filter(([, v]) => typeof v !== 'string'));
  return (
    <div className="ed-stack">
      <div className="ed-grid">
        <Input label={t('sr.general.name')} value={text(draft.name)} error={issueAt(issues, 'name')} onChange={(e) => setDraft(setPath(draft, ['name'], e.target.value))} />
        <Input label={t('sr.general.desc')} value={text(draft.desc)} error={issueAt(issues, 'desc')} onChange={(e) => setDraft(setPath(draft, ['desc'], e.target.value))} />
        <div className="ed-wide">
          <KeyValueInput
            label={t('sr.general.labels')}
            help={locked ? undefined : t('sr.general.labelsHelp')}
            mono
            value={textLabels}
            error={issueAt(issues, 'labels')}
            onChange={(map) => setDraft(setPath(draft, ['labels'], { ...otherLabels, ...map }))}
          />
        </div>
      </div>
      <Overview
        title={t('sr.overview')}
        rows={[
          { tab: 'matching', label: t('sr.tab.matching'), value: matching(draft) },
          { tab: 'upstream', label: t('rt.tab.upstream'), value: upstream(draft, ctx) },
          { tab: 'plugins', label: t('pl.tab'), value: plugins(draft, ctx) },
          { tab: 'advanced', label: t('sr.tab.advanced'), value: advanced(draft) },
        ]}
      />
    </div>
  );
}
