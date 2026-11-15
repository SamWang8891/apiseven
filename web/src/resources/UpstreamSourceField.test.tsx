// The shared "Proxy to" control as the service editor uses it (no service of its own) and as the
// stream route editor words it. Its route behaviour is covered by routes/tabs.test.tsx, through the
// route editor's Upstream tab, which is a thin user of it.
import { cleanup, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Obj } from '../api/types';
import { t } from '../i18n';
import { ctxOf, itemOf } from '../test/ctx';
import { editableControls } from '../test/schemaForm';
import { renderTab, type TabOptions } from '../test/tab';
import { upstreamIssues } from '../upstream/validate';
import { isObj } from '../api/sanitize';
import type { TabProps } from './registry';
import { UpstreamSourceField } from './UpstreamSourceField';

beforeAll(async () => {
  await import('../upstream/UpstreamForm');
});

const CTX = ctxOf({
  upstreams: [itemOf('u1', { name: 'web-pool', nodes: [{ host: '10.0.0.11', port: 8080, weight: 1 }] })],
  services: [itemOf('s1', { name: 'web', upstream_id: 'u1' })],
});

const inlineIssues = (draft: Obj) => (isObj(draft.upstream) ? upstreamIssues(draft.upstream, 'upstream') : []);

function ServiceSource(p: TabProps) {
  return <UpstreamSourceField draft={p.draft} setDraft={p.setDraft} ctx={p.ctx} issues={p.issues} isNew={p.isNew} kind={p.kind} allowService={false} />;
}
function StreamSource(p: TabProps) {
  return <UpstreamSourceField draft={p.draft} setDraft={p.setDraft} ctx={p.ctx} issues={p.issues} isNew={p.isNew} kind={p.kind} allowService />;
}

const service = (draft: Obj, opts: TabOptions = {}) => renderTab('services', ServiceSource, draft, inlineIssues, { ctx: CTX, ...opts });
const radio = (key: string) => screen.getByRole('radio', { name: t(`rt.up.source.${key}`) });

describe('allowService={false} (a service)', () => {
  it('offers Existing and Inline only, and no service picker', () => {
    service({ name: 'svc', upstream_id: 'u1' });
    const group = screen.getByRole('radiogroup', { name: t('rt.up.source') });
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual([t('rt.up.source.existing'), t('rt.up.source.inline')]);
    expect(screen.queryByRole('combobox', { name: t('rt.up.service') })).not.toBeInTheDocument();
    expect(radio('existing')).toBeChecked();
  });

  it('switching never writes service_id: Existing → Inline → Existing, then a pick', async () => {
    const h = service({ name: 'svc', upstream_id: 'u1' });
    await h.user.click(radio('inline'));
    expect(h.value()).toEqual({ name: 'svc' });
    await h.user.click(radio('existing'));
    await h.user.click(screen.getByRole('combobox', { name: t('rt.up.upstream') }));
    await h.user.click(await screen.findByRole('option', { name: /web-pool/ }));
    expect(h.value()).toEqual({ name: 'svc', upstream_id: 'u1' });
    for (const [draft] of h.changes.mock.calls) expect(draft).not.toHaveProperty('service_id');
  });

  it('a service_id in the draft (only possible through the JSON) is no source and is left alone', async () => {
    const h = service({ name: 'svc', service_id: 's1', upstream: { nodes: [{ host: 'h', port: 1, weight: 1 }] } });
    expect(radio('inline')).toBeChecked();
    await h.user.click(radio('existing'));
    await h.user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: t('rt.up.discard.confirm') }));
    expect(h.value()).toEqual({ name: 'svc', service_id: 's1' });
  });

  it('a new service starts on Inline with the node table; nothing is written until a node is typed', async () => {
    const h = service({}, { isNew: true });
    expect(radio('inline')).toBeChecked();
    expect(await screen.findByRole('textbox', { name: t('up.nodes.new') })).toBeInTheDocument();
    expect(h.changes).not.toHaveBeenCalled();
  });

  it('a stored service without an upstream: no choice, a note, and "Resolves to" says its routes set their own (not a problem)', () => {
    service({ name: 'svc' });
    expect(radio('existing')).not.toBeChecked();
    expect(radio('inline')).not.toBeChecked();
    expect(screen.getByText(t('svc.up.noneNote'))).toBeInTheDocument();
    const line = screen.getByRole('group', { name: t('rt.up.resolves') });
    expect(line).toHaveTextContent(t('svc.up.resolvesNone'));
    expect(within(line).getByText(t('svc.up.resolvesNone'))).not.toHaveClass('res-resolves__label--none');
  });

  it('locked without an upstream: "No upstream", no form controls', () => {
    const { container } = service({ name: 'svc' }, { locked: true });
    expect(screen.getByText(t('rt.up.source.none'))).toBeInTheDocument();
    expect(screen.getByRole('group', { name: t('rt.up.resolves') })).toHaveTextContent(t('svc.up.resolvesNone'));
    expect(editableControls(container)).toEqual([]);
  });

  it('Inline → Existing asks before discarding a non-empty inline upstream, in a service\'s words', async () => {
    const h = service({ name: 'svc', upstream: { nodes: [{ host: '10.0.0.1', port: 80, weight: 1 }] } });
    await h.user.click(radio('existing'));
    const dialog = await screen.findByRole('alertdialog', { name: t('rt.up.discard.title') });
    expect(dialog).toHaveTextContent(t('svc.up.discard.body'));
    expect(h.changes).not.toHaveBeenCalled();
    await h.user.click(within(dialog).getByRole('button', { name: t('rt.up.discard.confirm') }));
    expect(h.value()).toEqual({ name: 'svc' });
  });

  it('an inline upstream resolves to its nodes', () => {
    service({ upstream: { nodes: [{ host: '10.0.1.20', port: 3000, weight: 1 }] } }, { locked: true });
    expect(screen.getByRole('group', { name: t('rt.up.resolves') })).toHaveTextContent('10.0.1.20:3000');
  });
});

describe('an inline upstream left beside an upstream_id: what it means, per kind (fix round 1)', () => {
  const both = { upstream_id: 'u1', upstream: { nodes: [{ host: 'h', port: 1, weight: 1 }] } };
  function RouteSource(p: TabProps) {
    return <UpstreamSourceField draft={p.draft} setDraft={p.setDraft} ctx={p.ctx} issues={p.issues} isNew={p.isNew} kind={p.kind} allowService />;
  }

  it('a route, and a stream route: APISIX ignores it (its own upstream_id wins, init.lua 724 and 1894)', () => {
    renderTab('routes', RouteSource, { uri: '/x', ...both }, inlineIssues, { ctx: CTX });
    expect(screen.getByText(t('rt.up.alsoInline'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('rt.up.removeInline') })).toBeInTheDocument();
    cleanup();
    renderTab('stream_routes', StreamSource, { server_port: 9100, ...both }, inlineIssues, { ctx: CTX });
    expect(screen.getByText(t('rt.up.alsoInline'))).toBeInTheDocument();
  });

  it('a service: its routes use the chosen upstream, its stream routes the inline one; removing says so', async () => {
    const h = service({ name: 'svc', ...both });
    expect(screen.getByText(t('svc.up.alsoInline'))).toBeInTheDocument();
    expect(screen.queryByText(t('rt.up.alsoInline'))).not.toBeInTheDocument();
    await h.user.click(screen.getByRole('button', { name: t('svc.up.removeInline') }));
    expect(h.value()).toEqual({ name: 'svc', upstream_id: 'u1' });
  });
});

describe('"Resolves to" follows the subsystem (Ruling 4): a service with both an upstream_id and an inline upstream', () => {
  const both = ctxOf({
    upstreams: [itemOf('u1', { name: 'web-pool', nodes: [{ host: '10.0.0.11', port: 8080, weight: 1 }] })],
    services: [itemOf('s1', { name: 'both', upstream_id: 'u1', upstream: { nodes: [{ host: '10.0.9.9', port: 3000, weight: 1 }] } })],
  });
  function RouteSource(p: TabProps) {
    return <UpstreamSourceField draft={p.draft} setDraft={p.setDraft} ctx={p.ctx} issues={p.issues} isNew={p.isNew} kind={p.kind} allowService />;
  }

  it('a route resolves to its upstream_id (http)', () => {
    renderTab('routes', RouteSource, { uri: '/x', service_id: 's1' }, inlineIssues, { ctx: both, locked: true });
    const line = screen.getByRole('group', { name: t('rt.up.resolves') });
    expect(line).toHaveTextContent(`web-pool${t('rt.up.viaService', { name: 'both' })}10.0.0.11:8080`);
  });

  it('a stream route resolves to its inline upstream', () => {
    renderTab('stream_routes', StreamSource, { server_port: 9100, service_id: 's1' }, inlineIssues, { ctx: both, locked: true });
    const line = screen.getByRole('group', { name: t('rt.up.resolves') });
    expect(line).toHaveTextContent(`${t('rt.up.serviceInline')}${t('rt.up.viaService', { name: 'both' })}10.0.9.9:3000`);
  });
});

describe('a stream route (allowService, kind stream_routes)', () => {
  it('offers the service\'s upstream, and says what having none means for a stream route', () => {
    renderTab('stream_routes', StreamSource, { server_port: 9100 }, inlineIssues, { ctx: CTX });
    expect(screen.getByRole('combobox', { name: t('rt.up.service') })).toBeInTheDocument();
    // Disabled, still readable (aria-disabled, known item 17).
    expect(radio('service')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(t('sr.up.noneNote'))).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: t('rt.up.resolves') })).getByText(t('rt.up.resolvesNone'))).toHaveClass('res-resolves__label--none');
  });

  it('with a service, starts on its upstream and resolves through it', () => {
    renderTab('stream_routes', StreamSource, { server_port: 9100, service_id: 's1' }, inlineIssues, { ctx: CTX, locked: true });
    expect(screen.getByRole('group', { name: t('rt.up.resolves') })).toHaveTextContent(`web-pool${t('rt.up.viaService', { name: 'web' })}`);
  });
});
