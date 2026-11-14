// The Upstream editor and list as the registry wires them: General + one tab per form section.
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Obj } from '../../api/types';
import { resetReadOnlyKeys } from '../../api/write';
import { t } from '../../i18n';
import { schemaErrors } from '../../schema/ajv';
import { resetApp } from '../../test/app';
import { main, openEditor, writesOf } from '../../test/editor';
import { editableControls } from '../../test/schemaForm';
import { upstreamSchema } from '../../test/upstreamSchema';
import { getToasts } from '../../ui/toast';

/** The accessible name of a field marked required. */
const req = (label: string) => `${label} (${t('ui.required')})`;

// The section tabs load their module on first view; load it once up front, so the first test's
// wait isn't spent transforming it.
beforeAll(async () => {
  await import('../../upstream/SectionTab');
});

afterEach(() => {
  resetApp();
  resetReadOnlyKeys();
});

/** A tab by its label (its name also counts its problems). */
const tab = (label: string | RegExp) => main().getByRole('tab', { name: typeof label === 'string' ? new RegExp(`^${label}`) : label });
const POOL: Obj = {
  id: 'web-pool',
  name: 'web-pool',
  type: 'roundrobin',
  nodes: [{ host: '10.0.0.11', port: 8080, weight: 1 }, { host: '10.0.0.12', port: 8080, weight: 1 }],
  timeout: { connect: 3, send: 10, read: 10 },
};

describe('the upstream editor', () => {
  it('has General, the five sections and JSON, in that order', async () => {
    await openEditor('#/upstreams/web-pool', { objects: { upstreams: [POOL] } });
    await main().findByRole('heading', { level: 1, name: 'web-pool' });
    expect(main().getAllByRole('tab').map((el) => el.textContent)).toEqual([
      t('up.tab.general'),
      t('up.section.nodes'),
      t('up.section.balancing'),
      t('up.section.health'),
      t('up.section.connection'),
      t('up.section.tls'),
      t('editor.json.tab'),
    ]);
  });

  it('creates an upstream through the form with a body APISIX accepts', async () => {
    const { user, admin } = await openEditor('#/upstreams/new', { objects: { upstreams: [] } });
    await user.type(await main().findByRole('textbox', { name: t('up.general.name') }), 'orders');

    await user.click(tab(t('up.section.nodes')));
    await user.type(await main().findByRole('textbox', { name: t('up.nodes.new') }), '10.0.0.5');
    await user.type(main().getByRole('spinbutton', { name: t('up.nodes.portN', { n: 1 }) }), '8080');
    await user.click(main().getByRole('textbox', { name: t('up.nodes.new') }));
    await user.paste('10.0.0.6:8080');

    await user.click(tab(t('up.section.balancing')));
    await user.click(await main().findByRole('combobox', { name: t('up.balance.type') }));
    await user.click(await screen.findByRole('option', { name: t('up.balance.least_conn') }));

    await user.click(tab(t('up.section.health')));
    await user.click(await main().findByRole('switch', { name: t('up.hc.active') }));
    await user.type(main().getByRole('textbox', { name: t('up.hc.path') }), '/healthz');

    await user.click(tab(t('up.section.connection')));
    await user.type(await main().findByRole('spinbutton', { name: t('up.conn.connect') }), '3');

    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    const [post] = writesOf(admin);
    expect(post?.method).toBe('POST');
    expect(post?.path).toBe('upstreams');
    expect(post?.body).toEqual({
      name: 'orders',
      type: 'least_conn',
      nodes: [
        { host: '10.0.0.5', port: 8080, weight: 1 },
        { host: '10.0.0.6', port: 8080, weight: 1 },
      ],
      checks: { active: { http_path: '/healthz' } },
      timeout: { connect: 3, send: 60, read: 60 },
    });
    expect(schemaErrors(upstreamSchema(), post?.body)).toEqual([]);
  });

  it('blocks Save on a problem and badges its tab', async () => {
    const { user, admin } = await openEditor('#/upstreams/web-pool', { objects: { upstreams: [{ ...POOL, type: 'chash' }] } });
    await main().findByRole('heading', { level: 1, name: 'web-pool' });
    await waitFor(() => expect(tab(/^Load balancing/)).toHaveAccessibleName(`${t('up.section.balancing')} ${t('ui.tabs.errors', { count: 1 })}`));
    await user.keyboard('e');
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    expect(getToasts().at(-1)?.message).toBe(t('editor.fixOne'));
    expect(writesOf(admin)).toEqual([]);
    // Hashing on vars, the key field suggests the variables APISIX allows: a combobox.
    expect(await main().findByRole('combobox', { name: req(t('up.balance.key')) })).toHaveAccessibleDescription(t('up.issue.key'));
  });

  it('reads as a spec sheet when locked: an overview on General, a plain node table', async () => {
    const { user } = await openEditor('#/upstreams/web-pool', { objects: { upstreams: [POOL] } });
    await main().findByRole('heading', { level: 1, name: 'web-pool' });
    const overview = main().getByRole('region', { name: t('up.overview') });
    expect(within(overview).getByRole('link', { name: t('up.section.nodes') })).toBeInTheDocument();
    expect(overview).toHaveTextContent('2 nodes: 10.0.0.11:8080, 10.0.0.12:8080');
    expect(overview).toHaveTextContent('Round robin');

    await user.click(within(overview).getByRole('link', { name: t('up.section.nodes') }));
    const table = await main().findByRole('table');
    expect(editableControls(main().getByRole('tabpanel'))).toEqual([]);
    expect(within(table).getAllByRole('row')).toHaveLength(3);
  });
});

describe('the upstream list', () => {
  it('counts what uses each upstream', async () => {
    await openEditor('#/upstreams', {
      objects: {
        upstreams: [POOL, { id: 'idle', name: 'idle', nodes: { 'a:1': 1 } }],
        routes: [{ id: 'r1', uri: '/a', upstream_id: 'web-pool' }, { id: 'r2', uri: '/b', upstream_id: 'web-pool' }],
      },
    });
    const row = (await main().findByRole('link', { name: 'web-pool' })).closest('tr') as HTMLElement;
    await waitFor(() => expect(within(row).getByRole('button', { name: t('cell.usedBy', { count: 2 }) })).toBeInTheDocument());
    const idle = main().getByRole('link', { name: 'idle' }).closest('tr') as HTMLElement;
    expect(within(idle).getByText(t('cell.unused'))).toBeInTheDocument();
  });
});
