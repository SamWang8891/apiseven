// The route editor's Upstream tab: the service the route belongs to, then where its requests go —
// the service's upstream, an upstream object, or one written inline — and a line saying what that
// resolves to, so the effective target is always in view (inherited too). Choosing a source removes
// the other source's key; a switch that removes an inline upstream holding anything asks first,
// since tabs are remounted on every switch and nothing could bring it back.
import { useId, useState } from 'react';
import { isObj } from '../../api/sanitize';
import type { Obj } from '../../api/types';
import { setPath, setPathRaw } from '../../editor/draft';
import { issueAt, withinPath } from '../../editor/issues';
import { t } from '../../i18n';
import { UpstreamForm } from '../../upstream/UpstreamForm';
import { Button, ConfirmDialog, Field, PendingScope, Segmented, useEditingState, useLocked } from '../../ui';
import { ReadOnlyValue } from '../../ui/ReadOnly';
import type { TabProps } from '../registry';
import { ResourcePicker } from '../ResourcePicker';
import { isEmptyUpstream, sourceOf, targetOf, withSource, type UpstreamSource } from './source';
import './routes.css';

const idOf = (v: unknown): string | undefined => (typeof v === 'number' ? String(v) : typeof v === 'string' && v !== '' ? v : undefined);

/** What the route's requests go to, as APISIX resolves it: a name, where it comes from, and the nodes in mono. */
function Resolves({ draft, ctx }: Pick<TabProps, 'draft' | 'ctx'>) {
  const id = useId();
  const target = targetOf(draft, ctx);
  return (
    <div role="group" aria-labelledby={id} className="rt-resolves">
      <span className="rt-resolves__title" id={id}>
        {t('rt.up.resolves')}
      </span>
      <span className={target.broken ? 'rt-resolves__label rt-resolves__label--none' : 'rt-resolves__label'}>{target.label}</span>
      {target.viaService !== undefined && <span className="rt-resolves__via">{t('rt.up.viaService', { name: target.viaService })}</span>}
      {target.nodes.length > 0 && (
        <span className="rt-resolves__nodes">
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

export function UpstreamTab({ draft, setDraft, ctx, issues, isNew }: TabProps) {
  const locked = useLocked();
  const serviceId = idOf(draft.service_id);
  const derived = sourceOf(draft);
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
    { value: 'service', label: t('rt.up.source.service'), disabled: serviceId === undefined },
    { value: 'existing', label: t('rt.up.source.existing') },
    { value: 'inline', label: t('rt.up.source.inline') },
  ];

  return (
    <div className="ed-stack">
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

      <div className="rt-source">
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
            help={locked ? undefined : serviceId === undefined ? t('rt.up.sourceHelpNoService') : undefined}
            error={issueAt(issues, '')}
          />
        )}
        {source === 'none' && !locked && <p className="rt-note">{t('rt.up.noneNote')}</p>}
        <Resolves draft={draft} ctx={ctx} />
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
            <div className="rt-leftover">
              <p className="rt-note">{t('rt.up.alsoInline')}</p>
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
            />
          </PendingScope>
        </div>
      )}

      <ConfirmDialog
        open={asking !== undefined}
        title={t('rt.up.discard.title')}
        body={inlineHeld ? t('rt.up.discard.bodyHeld') : t('rt.up.discard.body')}
        confirmLabel={t('rt.up.discard.confirm')}
        cancelLabel={t('rt.up.discard.cancel')}
        danger
        onConfirm={() => asking && apply(asking)}
        onCancel={() => setAsking(undefined)}
      />
    </div>
  );
}
