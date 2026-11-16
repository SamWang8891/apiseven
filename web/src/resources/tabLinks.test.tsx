// Fix round 1, F2: every in-page tab link (the overviews) changes only `tab`. On a Duplicate page each
// keeps `from`, so following it switches the tab of the copy, never asks to discard it.
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Kind, Obj } from '../api/types';
import { resetReadOnlyKeys } from '../api/write';
import { t } from '../i18n';
import { newPathFor } from '../router/paths';
import { resetApp } from '../test/app';
import { main, openEditor, writesOf } from '../test/editor';
import { pluginReplies } from '../test/plugins';

beforeAll(async () => {
  await import('../upstream/SectionTab');
  await import('../upstream/UpstreamForm');
});

afterEach(() => {
  resetApp();
  resetReadOnlyKeys();
});

const POOL: Obj = { id: 'pool', name: 'pool', type: 'roundrobin', nodes: [{ host: '10.0.0.1', port: 80, weight: 1 }] };

/** Each kind with an overview: the object copied, the overview's name, and the link followed. */
const KINDS: [Kind, { objects: Record<string, Obj[]>; from: string; overview: string; link: string }][] = [
  ['routes', { objects: { routes: [{ id: 'r1', name: 'r1', uri: '/a', upstream_id: 'pool' }], upstreams: [POOL] }, from: 'r1', overview: 'rt.overview', link: 'rt.tab.matching' }],
  ['services', { objects: { services: [{ id: 's1', name: 's1', upstream_id: 'pool' }], upstreams: [POOL] }, from: 's1', overview: 'svc.overview', link: 'pl.tab' }],
  ['stream_routes', { objects: { stream_routes: [{ id: 'sr1', name: 'sr1', server_port: 9100, upstream_id: 'pool' }], upstreams: [POOL] }, from: 'sr1', overview: 'sr.overview', link: 'sr.tab.matching' }],
  ['upstreams', { objects: { upstreams: [POOL] }, from: 'pool', overview: 'up.overview', link: 'up.section.nodes' }],
  ['consumers', { objects: { consumers: [{ username: 'jo', desc: 'Jo' }] }, from: 'jo', overview: 'cs.overview', link: 'pl.tab' }],
];

describe("every overview's links keep the page's other search parameters", () => {
  it.each(KINDS)('%s: on a Duplicate page, each link keeps `from`; following one switches the tab of the copy', async (kind, c) => {
    const { user, admin } = await openEditor(`#${newPathFor(kind)}?from=${c.from}`, { objects: c.objects, replies: pluginReplies() });
    await main().findByRole('button', { name: t('editor.create') });
    const overview = await main().findByRole('region', { name: t(c.overview) });
    const links = within(overview).getAllByRole('link');
    expect(links.length).toBeGreaterThan(1);
    for (const link of links) {
      const params = new URLSearchParams(link.getAttribute('href')?.split('?')[1]);
      expect(params.get('from'), link.textContent ?? '').toBe(c.from);
      expect(params.get('tab'), link.textContent ?? '').not.toBeNull();
    }
    await user.click(within(overview).getByRole('link', { name: t(c.link) }));
    await waitFor(() => expect(main().getByRole('tab', { selected: true })).toHaveAccessibleName(new RegExp(`^${t(c.link)}`)));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(new URLSearchParams(window.location.hash.split('?')[1]).get('from')).toBe(c.from);
    expect(writesOf(admin)).toEqual([]);
  });
});
