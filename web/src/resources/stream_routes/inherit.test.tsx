// What a stream route takes from its service, as APISIX's stream subsystem merges them
// (stream_preread_phase, apisix/init.lua 1894–1947; merge_service_stream_route, plugin.lua 775–802),
// branch by branch, through every place that shows it: the list's plugins column (accessor and
// cell), the General overview, the Plugins tab's inherited list and "Resolves to".
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Obj } from '../../api/types';
import { t } from '../../i18n';
import { DraftPluginsTab } from '../../plugins/PluginsTab';
import { ctxOf, itemOf } from '../../test/ctx';
import { renderWithProviders } from '../../test/providers';
import { renderTab } from '../../test/tab';
import type { TabProps } from '../registry';
import { streamEffectivePlugins, upstreamSummary } from '../resolve';
import { GeneralTab, UpstreamTab } from './bodies';
import { streamRouteColumns } from './columns';
import { streamRouteIssues } from './validate';

beforeAll(async () => {
  await import('../../upstream/UpstreamForm');
});

// Each service has a stream plugin (limit-conn) and an http one (limit-count, which never runs there).
const PLUGINS = { 'limit-conn': {}, 'limit-count': {} };
const CTX = ctxOf({
  upstreams: [
    itemOf('web-pool', { name: 'web-pool', nodes: [{ host: '10.0.0.11', port: 8080, weight: 1 }] }),
    itemOf('own-pool', { name: 'own-pool', nodes: [{ host: '10.0.0.99', port: 9000, weight: 1 }] }),
  ],
  services: [
    itemOf('s-id', { name: 's-id', upstream_id: 'web-pool', plugins: PLUGINS }),
    itemOf('s-inline', { name: 's-inline', upstream: { nodes: [{ host: '10.0.1.1', port: 1000, weight: 1 }] }, plugins: PLUGINS }),
    itemOf('s-both', { name: 's-both', upstream_id: 'web-pool', upstream: { nodes: [{ host: '10.0.2.2', port: 2000, weight: 1 }] }, plugins: PLUGINS }),
    itemOf('s-none', { name: 's-none', plugins: PLUGINS }),
  ],
});
const OWN = { 'ip-restriction': { whitelist: ['10.0.0.0/8'] } };
const MERGED = ['ip-restriction', 'limit-conn'];

/** [branch, the stream route, the plugins that run (by name), what "Resolves to" says]. */
const BRANCHES: [string, Obj, string[], string][] = [
  ['1. its own upstream_id: not merged (init.lua 1894–1905)', { service_id: 's-id', upstream_id: 'own-pool', plugins: OWN }, ['ip-restriction'], 'own-pool10.0.0.99:9000'],
  ['2. its own inline upstream and a service: merged, its own upstream kept (plugin.lua 793–795)', { service_id: 's-id', upstream: { nodes: [{ host: '10.9.9.9', port: 99, weight: 1 }] }, plugins: OWN }, MERGED, `${t('rt.up.source.inline')}10.9.9.9:99`],
  ['3. a service with an inline upstream: merged, its upstream (init.lua 1922)', { service_id: 's-inline', plugins: OWN }, MERGED, `${t('rt.up.serviceInline')}${t('rt.up.viaService', { name: 's-inline' })}10.0.1.1:1000`],
  ['4. a service with an upstream_id: merged, its upstream_id (plugin.lua 797–799; init.lua 1923–1933)', { service_id: 's-id', plugins: OWN }, MERGED, `web-pool${t('rt.up.viaService', { name: 's-id' })}10.0.0.11:8080`],
  ['5. a service with both: merged, its inline upstream wins (plugin.lua 793–799; init.lua 1922–1923)', { service_id: 's-both', plugins: OWN }, MERGED, `${t('rt.up.serviceInline')}${t('rt.up.viaService', { name: 's-both' })}10.0.2.2:2000`],
  ['6. a service without an upstream: merged, no upstream (set_by_route: "missing upstream configuration")', { service_id: 's-none', plugins: OWN }, MERGED, t('rt.up.resolvesNone')],
];

const col = (id: string) => streamRouteColumns.find((c) => c.id === id);
const tab = (Tab: ComponentType<TabProps>, draft: Obj) => renderTab('stream_routes', Tab, draft, streamRouteIssues, { ctx: CTX, locked: true });

function StreamPlugins(p: TabProps) {
  return <DraftPluginsTab {...p} scope="stream_route" />;
}

describe.each(BRANCHES)('%s', (_, route, runs, resolves) => {
  const item = itemOf('sr', route);
  const inherited = runs.filter((name) => name !== 'ip-restriction');

  it('the rule (streamEffectivePlugins), the column\'s accessor and its cell', () => {
    expect(streamEffectivePlugins(route, CTX).map((p) => p.name)).toEqual(runs);
    expect(col('plugins')?.accessor(item, CTX)).toEqual(runs);
    renderWithProviders(<div data-testid="cell">{col('plugins')?.cell?.(item, CTX)}</div>, { counts: {} });
    const cell = screen.getByTestId('cell');
    for (const name of runs) expect(cell).toHaveTextContent(name);
    expect(cell).not.toHaveTextContent('limit-count');
    if (inherited.length === 0) expect(cell).not.toHaveTextContent('limit-conn');
  });

  it('the General overview', () => {
    tab(GeneralTab, route);
    const line = within(screen.getByRole('region', { name: t('sr.overview') })).getByRole('link', { name: t('pl.tab') }).closest('div') as HTMLElement;
    for (const name of runs) expect(line).toHaveTextContent(name);
    expect(line).not.toHaveTextContent('limit-count');
    if (inherited.length === 0) expect(line).not.toHaveTextContent(t('rt.overview.viaService'));
  });

  it('the Plugins tab\'s inherited list', async () => {
    tab(StreamPlugins, route);
    await waitFor(() => expect(screen.queryByText(t('pl.loading'))).not.toBeInTheDocument());
    const list = screen.queryByRole('list', { name: t('pl.inherited.title') });
    if (inherited.length === 0) expect(list).toBeNull();
    else expect(within(list as HTMLElement).getAllByRole('listitem').map((li) => li.querySelector('.pl-inherited__name')?.textContent)).toEqual(inherited);
  });

  it('"Resolves to" (and the list\'s upstream summary)', () => {
    tab(UpstreamTab, route);
    expect(screen.getByRole('group', { name: t('rt.up.resolves') })).toHaveTextContent(`${t('rt.up.resolves')}${resolves}`);
    cleanup();
    expect(upstreamSummary(route, CTX, 'stream').source).toBe(route.upstream_id ? 'upstream' : route.upstream ? 'inline' : route.service_id === 's-none' ? 'none' : 'service');
  });
});

describe('while the services load', () => {
  const loading = ctxOf({ ...CTX, loaded: { services: false } });

  it('a stream route that merges with its service says its inherited plugins are loading, in the Plugins tab and the overview', async () => {
    renderTab('stream_routes', StreamPlugins, { service_id: 's-id', plugins: OWN }, streamRouteIssues, { ctx: loading, locked: true });
    expect(await screen.findByText(t('pl.inherited.loading'))).toBeInTheDocument();
    cleanup();
    renderTab('stream_routes', GeneralTab, { service_id: 's-id', plugins: OWN }, streamRouteIssues, { ctx: loading, locked: true });
    expect(screen.getByRole('region', { name: t('sr.overview') })).toHaveTextContent(t('rt.overview.inheritedLoading'));
  });

  it('one with its own upstream_id inherits nothing, so nothing is loading', async () => {
    renderTab('stream_routes', StreamPlugins, { service_id: 's-id', upstream_id: 'own-pool', plugins: OWN }, streamRouteIssues, { ctx: loading, locked: true });
    await waitFor(() => expect(screen.queryByText(t('pl.loading'))).not.toBeInTheDocument());
    expect(screen.queryByText(t('pl.inherited.loading'))).not.toBeInTheDocument();
    cleanup();
    renderTab('stream_routes', GeneralTab, { service_id: 's-id', upstream_id: 'own-pool', plugins: OWN }, streamRouteIssues, { ctx: loading, locked: true });
    expect(screen.getByRole('region', { name: t('sr.overview') })).not.toHaveTextContent(t('rt.overview.inheritedLoading'));
  });
});

describe('an http route with its own upstream_id still runs its service\'s plugins (http always merges)', () => {
  it('effectivePlugins, unchanged', async () => {
    const { effectivePlugins } = await import('../resolve');
    expect(effectivePlugins({ service_id: 's-id', upstream_id: 'own-pool', plugins: OWN }, CTX).map((p) => p.name)).toEqual(['ip-restriction', 'limit-conn', 'limit-count']);
  });
});
