// Where an object's requests go, shared by the route, stream route and service editors: the service
// the object belongs to (routes and stream routes), then the three-way "Proxy to" choice — the
// service's upstream, an upstream object, or one written inline — and a line saying what that
// resolves to, so the effective target is always in view (inherited too). Choosing a source removes
// the other source's key; a switch that removes an inline upstream holding anything asks first,
// since tabs are remounted on every switch and nothing could bring it back. A service has no service
// of its own (`allowService={false}`): it offers Existing and Inline only, and may have neither.
import { useId, useState, type FC } from 'react';
import { isObj } from '../api/sanitize';
import type { Kind, Obj } from '../api/types';
import { setPath, setPathRaw } from '../editor/draft';
import { issueAt, withinPath, type Issue } from '../editor/issues';
import { t } from '../i18n';
import { UpstreamForm } from '../upstream/UpstreamForm';
import { Button, ConfirmDialog, Field, PendingScope, Segmented, useEditingState, useLocked } from '../ui';
import { ReadOnlyValue } from '../ui/ReadOnly';
import type { Ctx } from './ctx';
import type { Subsystem } from './resolve';
import { ResourcePicker } from './ResourcePicker';
import { isEmptyUpstream, sourceOf, targetOf, withSource, type UpstreamSource } from './upstreamSource';
import './resources.css';

const idOf = (v: unknown): string | undefined => (typeof v === 'number' ? String(v) : typeof v === 'string' && v !== '' ? v : undefined);

export interface UpstreamSourceFieldProps {
  draft: Obj;
  setDraft: (next: Obj) => void;
  ctx: Ctx;
  issues: Issue[];
  /** false (the service editor): no "Service's upstream" option and no service picker; service_id is never written. */
  allowService: boolean;
  /** A new object with no upstream yet starts on Inline (a stored one with none says so). */
  isNew?: boolean;
  /** Whose upstream this is, for the wording of what having none means; default a route's. */
  kind?: Kind;
}

/** What "no upstream" means for the object that has none: a route and a stream route can't proxy; a service leaves it to its routes. */
function noneTexts(allowService: boolean, kind: Kind | undefined): { note: string; resolves: string; broken: boolean; discard: string; discardHeld: string } {
  if (!allowService) {
    return { note: t('svc.up.noneNote'), resolves: t('svc.up.resolvesNone'), broken: false, discard: t('svc.up.discard.body'), discardHeld: t('svc.up.discard.bodyHeld') };
  }
  const note = kind === 'stream_routes' ? t('sr.up.noneNote') : t('rt.up.noneNote');
  return { note, resolves: t('rt.up.resolvesNone'), broken: true, discard: t('rt.up.discard.body'), discardHeld: t('rt.up.discard.bodyHeld') };
}

/** What the object's requests go to, as APISIX resolves it: a name, where it comes from, and the nodes in mono. */
function Resolves({ draft, ctx, none, subsystem }: { draft: Obj; ctx: Ctx; none: { resolves: string; broken: boolean }; subsystem: Subsystem }) {
  const id = useId();
  const target = targetOf(draft, ctx, subsystem);
  const label = target.none ? none.resolves : target.label;
  const broken = target.none ? none.broken : target.broken;
  return (
    <div role="group" aria-labelledby={id} className="res-resolves">
      <span className="res-resolves__title" id={id}>
        {t('rt.up.resolves')}
      </span>
      <span className={broken ? 'res-resolves__label res-resolves__label--none' : 'res-resolves__label'}>{label}</span>
      {target.viaService !== undefined && <span className="res-resolves__via">{t('rt.up.viaService', { name: target.viaService })}</span>}
      {target.nodes.length > 0 && (
        <span className="res-resolves__nodes">
          {target.nodes.map((node) => (
            <span key={node} className="ui-chip mono">
              {node}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

export const UpstreamSourceField: FC<UpstreamSourceFieldProps> = ({ draft, setDraft, ctx, issues, allowService, isNew = false, kind }) => {
  const locked = useLocked();
  const serviceId = allowService ? idOf(draft.service_id) : undefined;
  // A service's own `service_id` (only possible through the JSON, and refused by APISIX) is no source.
  const sourced = allowService ? draft : { ...draft, service_id: undefined };
  const derived = sourceOf(sourced);
  const none = noneTexts(allowService, kind);
  // A stream route reads a service's upstream, and its own inline one, in the stream subsystem's way.
  const subsystem: Subsystem = kind === 'stream_routes' ? 'stream' : 'http';
  // A choice the draft can't say yet (Existing before one is picked, Inline before a node is typed)
  // belongs to this editing session: it starts over on Save and Discard, and the locked view never
  // shows it, so the spec sheet always says what the draft proxies to.
  const [chosen, setChosen] = useEditingState<UpstreamSource | undefined>(undefined);
  const pick = locked ? undefined : chosen;
  let source: UpstreamSource;
  if (derived === 'existing' || derived === 'inline') source = derived;
  else if (pick === 'existing' || pick === 'inline') source = pick;
  else if (serviceId !== undefined) source = 'service';
  else source = isNew ? 'inline' : 'none';

  const [asking, setAsking] = useState<UpstreamSource>();
  // Whether a field of the inline form holds input it has not emitted: leaving it then asks too.
  const [inlineHeld, setInlineHeld] = useState(false);

  function apply(next: UpstreamSource) {
    setChosen(next);
    setAsking(undefined);
    const d = withSource(draft, next);
    if (d.upstream_id !== draft.upstream_id || d.upstream !== draft.upstream) setDraft(d);
  }
  function choose(next: string) {
    const to = next as UpstreamSource;
    if (to === source) return;
    // Asks first when the switch would lose something: input the inline form holds (whether or not
    // any of it is in the draft yet), or an inline upstream with content that the switch removes
    // (leaving Inline, or leaving Existing for the service's upstream with a leftover inline one).
    const losesHeld = source === 'inline' && inlineHeld;
    const removesUpstream = to !== 'inline' && isObj(draft.upstream) && !isEmptyUpstream(draft.upstream);
    const drops = losesHeld || removesUpstream;
    if (drops) setAsking(to);
    else apply(to);
  }

  const options = [
    ...(allowService ? [{ value: 'service', label: t('rt.up.source.service'), disabled: serviceId === undefined }] : []),
    { value: 'existing', label: t('rt.up.source.existing') },
    { value: 'inline', label: t('rt.up.source.inline') },
  ];

  return (
    <div className="ed-stack">
      {allowService && (
        <div className="ed-grid">
          <ResourcePicker
            kind="services"
            items={ctx.services}
            loading={!ctx.loaded.services}
            clearable
            label={t('rt.up.service')}
            help={locked ? undefined : t('rt.up.serviceHelp')}
            value={serviceId}
            error={issueAt(issues, 'service_id')}
            placeholder={t('rt.up.noService')}
            onChange={(id) => setDraft(setPath(draft, ['service_id'], id))}
          />
        </div>
      )}

      <div className="res-source">
        {locked && source === 'none' ? (
          <Field label={t('rt.up.source')}>
            <ReadOnlyValue>{t('rt.up.source.none')}</ReadOnlyValue>
          </Field>
        ) : (
          <Segmented
            label={t('rt.up.source')}
            value={source}
            onChange={choose}
            options={options}
            help={locked || !allowService ? undefined : serviceId === undefined ? t('rt.up.sourceHelpNoService') : undefined}
            error={issueAt(issues, '')}
          />
        )}
        {source === 'none' && !locked && <p className="res-source__note">{none.note}</p>}
        <Resolves draft={sourced} ctx={ctx} none={none} subsystem={subsystem} />
      </div>

      {source === 'existing' && (
        <div className="ed-grid">
          <ResourcePicker
            kind="upstreams"
            items={ctx.upstreams}
            loading={!ctx.loaded.upstreams}
            clearable
            label={t('rt.up.upstream')}
            value={idOf(draft.upstream_id)}
            error={issueAt(issues, 'upstream_id')}
            onChange={(id) => setDraft(setPath(draft, ['upstream_id'], id))}
          />
          {isObj(draft.upstream) && (
            <div className="res-leftover">
              <p className="res-source__note">{t('rt.up.alsoInline')}</p>
              {!locked && (
                <Button size="sm" onClick={() => setDraft(setPath(draft, ['upstream'], undefined))}>
                  {t('rt.up.removeInline')}
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {source === 'inline' && (
        <div>
          <PendingScope onChange={(entries) => setInlineHeld(entries.length > 0)}>
            <UpstreamForm
              layout="sections"
              value={isObj(draft.upstream) ? draft.upstream : {}}
              onChange={(up: Obj) => setDraft(setPathRaw(draft, ['upstream'], up))}
              issues={withinPath(issues, 'upstream')}
              ctx={ctx}
              subsystem={subsystem}
            />
          </PendingScope>
        </div>
      )}

      <ConfirmDialog
        open={asking !== undefined}
        title={t('rt.up.discard.title')}
        body={inlineHeld ? none.discardHeld : none.discard}
        confirmLabel={t('rt.up.discard.confirm')}
        cancelLabel={t('rt.up.discard.cancel')}
        danger
        onConfirm={() => asking && apply(asking)}
        onCancel={() => setAsking(undefined)}
      />
    </div>
  );
};
