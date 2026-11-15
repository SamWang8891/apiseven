// Where a route, a stream route or a service sends requests: the service's upstream (not for a
// service), an upstream object, or one written inline. Pure; UpstreamSourceField is the control.
import { isObj } from '../api/sanitize';
import type { Obj } from '../api/types';
import { t } from '../i18n';
import type { Ctx } from './ctx';
import { ownUpstream, upstreamSummary, type Subsystem } from './resolve';

export type UpstreamSource = 'service' | 'existing' | 'inline' | 'none';

const hasId = (v: unknown): boolean => (typeof v === 'string' && v !== '') || typeof v === 'number';

/**
 * The source the draft says: `upstream_id` wins over an inline `upstream` (as APISIX proxies to the
 * upstream_id when both are set), then the inline one, then the service's; 'none' when there is none.
 */
export function sourceOf(draft: Obj): UpstreamSource {
  if (hasId(draft.upstream_id)) return 'existing';
  if (isObj(draft.upstream)) return 'inline';
  if (hasId(draft.service_id)) return 'service';
  return 'none';
}

/** An inline upstream with nothing in it worth asking about: no nodes, no settings but the default type. */
export function isEmptyUpstream(up: unknown): boolean {
  if (!isObj(up)) return true;
  return Object.entries(up).every(([key, v]) => {
    if (key === 'type') return v === 'roundrobin';
    if (key === 'nodes') return (Array.isArray(v) && v.length === 0) || (isObj(v) && Object.keys(v).length === 0);
    return false;
  });
}

/** The draft with only `source`'s keys of the three: the other upstream keys removed (service_id stays: it carries plugins too). */
export function withSource(draft: Obj, source: UpstreamSource): Obj {
  const next = { ...draft };
  if (source !== 'existing') delete next.upstream_id;
  if (source !== 'inline') delete next.upstream;
  return next;
}

/** What an object proxies to, for the "Resolves to" line and the overviews. */
export interface Target {
  /** The upstream's name (or its nodes, for an inline one); for none or a missing reference, the problem. */
  label: string;
  /** The service the upstream comes from, when it is inherited. */
  viaService?: string;
  nodes: string[];
  /** Nothing to proxy to, or a reference to an upstream that doesn't exist. */
  broken: boolean;
  /** No upstream at all, by any source (as opposed to one that is missing). */
  none?: true;
}

/**
 * Where the object's requests go, as APISIX resolves it in `subsystem` (upstreamSummary), naming an
 * inherited upstream rather than its service.
 */
export function targetOf(draft: Obj, ctx: Ctx, subsystem: Subsystem = 'http'): Target {
  // A list that hasn't loaded yet can't tell a missing object from one not seen yet.
  const own = hasId(draft.upstream_id) || isObj(draft.upstream);
  const waiting = hasId(draft.upstream_id) ? !ctx.loaded.upstreams : !own && hasId(draft.service_id) && !(ctx.loaded.services && ctx.loaded.upstreams);
  if (waiting) return { label: t('picker.loading'), nodes: [], broken: false };
  const summary = upstreamSummary(draft, ctx, subsystem);
  switch (summary.source) {
    case 'none':
      return { label: t('rt.up.resolvesNone'), nodes: [], broken: true, none: true };
    case 'missing':
      return { label: t('rt.issue.missing.upstream', { id: summary.refId ?? '' }), nodes: [], broken: true };
    case 'inline':
      return { label: t('rt.up.source.inline'), nodes: summary.nodes, broken: false };
    case 'upstream':
      return { label: summary.label, nodes: summary.nodes, broken: false };
    case 'service': {
      const service = ctx.services.find((item) => String(item.id) === summary.refId);
      const own = service ? ownUpstream(service.value, ctx, subsystem === 'stream') : undefined;
      const label = own?.source === 'upstream' ? own.label : t('rt.up.serviceInline');
      return { label, viaService: summary.label, nodes: summary.nodes, broken: false };
    }
  }
}
