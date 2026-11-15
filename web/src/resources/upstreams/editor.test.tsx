// The Upstream editor and list as the registry wires them: General + one tab per form section.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
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
const POOL_NODE_2 = { host: '10.0.0.12', port: 8080, weight: 1 };
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

  // Task 16b item 42: a choice the draft can't express yet (nothing typed) is view state the page keeps.
  it('a target or client-certificate choice made before typing anything survives a tab switch', async () => {
    const { user } = await openEditor('#/upstreams/~new', { objects: { upstreams: [] } });
    await main().findByRole('textbox', { name: t('up.general.name') });
    await user.click(tab(t('up.section.nodes')));
    await user.click(await main().findByRole('radio', { name: t('up.target.discovery') }));
    await user.click(tab(t('up.section.tls')));
    await user.click(await main().findByRole('radio', { name: t('up.tls.mode.inline') }));
    await user.click(tab(t('up.section.nodes')));
    expect(await main().findByRole('radio', { name: t('up.target.discovery') })).toBeChecked();
    await user.click(tab(t('up.section.tls')));
    expect(await main().findByRole('radio', { name: t('up.tls.mode.inline') })).toBeChecked();
  });

  // Fix round 1, F2: a mode chosen without typing is editing state: it survives a tab switch within the
  // session, and the session's end (Discard, a save) forgets it; the locked view says what is stored.
  it('a client-certificate mode chosen without typing: kept through a tab switch, gone after Discard and after a save', async () => {
    const { user, admin } = await openEditor('#/upstreams/web-pool?tab=tls', { objects: { upstreams: [POOL] } });
    await main().findByRole('heading', { level: 1, name: 'web-pool' });
    const lockedMode = () => main().getByText(t('up.tls.mode.none'));
    expect(await main().findByText(t('up.tls.mode.none'))).toBeInTheDocument();
    const choose = async () => {
      await user.keyboard('e');
      await user.click(await main().findByRole('radio', { name: t('up.tls.mode.inline') }));
    };
    await choose();
    await user.click(tab(t('up.section.nodes')));
    await user.click(tab(t('up.section.tls')));
    expect(await main().findByRole('radio', { name: t('up.tls.mode.inline') })).toBeChecked();
    await user.click(main().getByRole('button', { name: t('editor.discard') }));
    await main().findByRole('button', { name: t('editor.edit') });
    expect(lockedMode()).toBeInTheDocument();
    expect(main().queryByText(t('up.tls.mode.inline'))).not.toBeInTheDocument();
    await user.keyboard('e');
    expect(await main().findByRole('radio', { name: t('up.tls.mode.none') })).toBeChecked();
    await user.click(main().getByRole('button', { name: t('editor.discard') }));
    await main().findByRole('button', { name: t('editor.edit') });

    await choose();
    await user.click(tab(t('up.tab.general')));
    await user.type(await main().findByRole('textbox', { name: t('up.general.name') }), '-2');
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    await main().findByRole('button', { name: t('editor.edit') });
    await user.click(tab(t('up.section.tls')));
    expect(await main().findByText(t('up.tls.mode.none'))).toBeInTheDocument();
    expect(main().queryByText(t('up.tls.mode.inline'))).not.toBeInTheDocument();
  });

  // Fix round 1, F3/F4: the node table on the page: what a save sends is what the host fields show.
  describe('host text and the save gesture', () => {
    const hostN = (n: number) => main().getByRole('textbox', { name: t('up.nodes.hostN', { n }) });
    const cmdS = () => fireEvent.keyDown(window, { key: 's', metaKey: true });

    it('an array host typed as host:port, then Cmd/Ctrl-S at once: sent exactly as shown', async () => {
      const { user, admin } = await openEditor('#/upstreams/web-pool?tab=nodes', { objects: { upstreams: [POOL] } });
      await main().findByRole('heading', { level: 1, name: 'web-pool' });
      await user.keyboard('e');
      await user.clear(await waitFor(() => hostN(1)));
      await user.type(hostN(1), '10.0.0.9:9000');
      cmdS();
      await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
      expect((writesOf(admin)[0]?.body as Obj).nodes).toEqual([{ host: '10.0.0.9:9000', port: 8080, weight: 1 }, POOL_NODE_2]);
    });

    it('a map host with a stray colon, then Cmd/Ctrl-S at once: no request, the toast names the node', async () => {
      const MAPPED = { ...POOL, nodes: { '10.0.0.11:8080': 1, '10.0.0.12:8080': 1 } };
      const { user, admin } = await openEditor('#/upstreams/web-pool?tab=nodes', { objects: { upstreams: [MAPPED] } });
      await main().findByRole('heading', { level: 1, name: 'web-pool' });
      await user.keyboard('e');
      await user.clear(await waitFor(() => hostN(1)));
      await user.type(hostN(1), '10.0.0.9:');
      cmdS();
      await waitFor(() => expect(getToasts().at(-1)?.message).toContain(t('up.pending.unsaved', { node: t('up.pending.node', { n: 1 }), addr: '10.0.0.9:' })));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(writesOf(admin)).toEqual([]);
      expect(hostN(1)).toHaveValue('10.0.0.9:');
    });

    // Fix round 1, F6: an edit of one row re-words another row's hold; the refusal goes to the row that holds.
    it('row 3 held as a duplicate of row 1; row 1 retyped re-words that hold: a refused Save focuses row 3, not row 1', async () => {
      const MAPPED = { ...POOL, nodes: { 'a:80': 1, 'b:80': 1, 'c:80': 1 } };
      const { user } = await openEditor('#/upstreams/web-pool?tab=nodes', { objects: { upstreams: [MAPPED] } });
      await main().findByRole('heading', { level: 1, name: 'web-pool' });
      await user.keyboard('e');
      await user.clear(await waitFor(() => hostN(3)));
      await user.type(hostN(3), 'a');
      expect(hostN(3)).toHaveAttribute('aria-invalid', 'true');
      await user.clear(hostN(1));
      await user.type(hostN(1), 'a');
      expect(hostN(1)).not.toHaveAttribute('aria-invalid');
      expect(hostN(3)).toHaveAttribute('aria-invalid', 'true');
      await user.click(main().getByRole('button', { name: t('editor.save') }));
      expect(hostN(3)).toHaveFocus();
    });

    // Fix round 2, R1.3: a row held for a clash that another row's edit resolved stays flagged while it is held.
    it('row 3 held as a duplicate of row 1; row 1 renamed resolves it: row 3 stays flagged, a refused Save focuses it, leaving it adds it', async () => {
      const MAPPED = { ...POOL, nodes: { 'a:80': 1, 'b:80': 1, 'c:80': 1 } };
      const { user } = await openEditor('#/upstreams/web-pool?tab=nodes', { objects: { upstreams: [MAPPED] } });
      await main().findByRole('heading', { level: 1, name: 'web-pool' });
      await user.keyboard('e');
      await user.clear(await waitFor(() => hostN(3)));
      await user.type(hostN(3), 'a');
      await user.clear(hostN(1));
      await user.type(hostN(1), 'z');
      expect(hostN(3)).toHaveAttribute('aria-invalid', 'true');
      expect(hostN(3)).toHaveAccessibleDescription(t('up.nodes.heldNotYet'));
      await user.click(main().getByRole('button', { name: t('editor.save') }));
      expect(hostN(3)).toHaveFocus();
      await user.tab();
      expect(hostN(3)).not.toHaveAttribute('aria-invalid');
      await user.click(main().getByRole('button', { name: t('editor.save') }));
      await waitFor(async () => expect(await main().findByRole('button', { name: t('editor.edit') })).toBeInTheDocument());
    });

    it('a stored host holding a port: click in, Tab out: nothing changes, the page is not unsaved', async () => {
      const STORED = { ...POOL, nodes: [{ host: '10.0.0.5:8080', port: 80, weight: 1 }] };
      const { user } = await openEditor('#/upstreams/web-pool?tab=nodes', { objects: { upstreams: [STORED] } });
      await main().findByRole('heading', { level: 1, name: 'web-pool' });
      await user.keyboard('e');
      await user.click(await waitFor(() => hostN(1)));
      await user.tab();
      expect(hostN(1)).toHaveValue('10.0.0.5:8080');
      expect(main().getByRole('spinbutton', { name: t('up.nodes.portN', { n: 1 }) })).toHaveValue('80');
      expect(main().queryByText(t('editor.unsaved'))).not.toBeInTheDocument();
    });
  });

  // Fix round 2, F2: a save made from the same tab locks without remounting it; the next Edit starts over all the same.
  it('a client-certificate mode chosen without typing, then a change on the same tab and a save: the next Edit reads None', async () => {
    const { user, admin } = await openEditor('#/upstreams/web-pool?tab=tls', { objects: { upstreams: [POOL] } });
    await main().findByRole('heading', { level: 1, name: 'web-pool' });
    await main().findByText(t('up.tls.mode.none'));
    await user.keyboard('e');
    await user.click(await main().findByRole('radio', { name: t('up.tls.mode.inline') }));
    await user.click(main().getByRole('combobox', { name: new RegExp(`^${t('up.tls.verify')}`) }));
    await user.click(await screen.findByRole('option', { name: t('up.tls.verifyOff') }));
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    await main().findByRole('button', { name: t('editor.edit') });
    expect(main().getByText(t('up.tls.mode.none'))).toBeInTheDocument();
    await user.keyboard('e');
    expect(await main().findByRole('radio', { name: t('up.tls.mode.none') })).toBeChecked();
  });

  it('a target mode chosen without typing, then a save from the same tab: the next Edit reads Nodes', async () => {
    const { user, admin } = await openEditor('#/upstreams/web-pool?tab=nodes', { objects: { upstreams: [POOL] } });
    await main().findByRole('heading', { level: 1, name: 'web-pool' });
    await user.keyboard('e');
    await user.click(await main().findByRole('radio', { name: t('up.target.discovery') }));
    // Neither nodes nor a discovery service is refused here; Save anyway sends it (the fake APISIX takes it).
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    await user.click(await main().findByRole('button', { name: t('editor.anyway.action') }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: t('editor.anyway.confirm') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    await main().findByRole('button', { name: t('editor.edit') });
    await user.keyboard('e');
    expect(await main().findByRole('radio', { name: t('up.target.nodes') })).toBeChecked();
  });

  // Task 16b item 50: sections opened or closed on a tab are as the user left them after a tab switch.
  it('health-check sections opened or closed come back so after a tab switch', async () => {
    const { user } = await openEditor('#/upstreams/web-pool?tab=health', { objects: { upstreams: [{ ...POOL, checks: { active: { http_path: '/h' } } }] } });
    await main().findByRole('heading', { level: 1, name: 'web-pool' });
    await user.keyboard('e');
    const toggle = async (name: string) => main().findByRole('button', { name: new RegExp(`^${name}`) });
    await user.click(await toggle(t('up.hc.probe')));
    await user.click(await toggle(t('up.hc.healthy')));
    expect(await toggle(t('up.hc.probe'))).toHaveAttribute('aria-expanded', 'false');
    expect(await toggle(t('up.hc.healthy'))).toHaveAttribute('aria-expanded', 'true');
    await user.click(tab(t('up.section.nodes')));
    await user.click(tab(t('up.section.health')));
    expect(await toggle(t('up.hc.probe'))).toHaveAttribute('aria-expanded', 'false');
    expect(await toggle(t('up.hc.healthy'))).toHaveAttribute('aria-expanded', 'true');
    expect(await toggle(t('up.hc.unhealthy'))).toHaveAttribute('aria-expanded', 'false');
  });

  // Task 16b item 160: a refused Save opens a section the user closed while a problem sits inside it.
  it('a closed section with a problem inside opens on a refused Save, on its tab and after a tab switch', async () => {
    const BAD = { ...POOL, checks: { active: { unhealthy: { timeouts: 300 } } } };
    const { user, admin } = await openEditor('#/upstreams/web-pool?tab=health', { objects: { upstreams: [BAD] } });
    await main().findByRole('heading', { level: 1, name: 'web-pool' });
    await user.keyboard('e');
    const unhealthy = async () => main().findByRole('button', { name: new RegExp(`^${t('up.hc.unhealthy')}`) });
    expect(await unhealthy()).toHaveAttribute('aria-expanded', 'true');
    await user.click(await unhealthy());
    expect(await unhealthy()).toHaveAttribute('aria-expanded', 'false');
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    expect(await unhealthy()).toHaveAttribute('aria-expanded', 'true');
    // Closed again, then away: the refused Save brings the user back to it, open.
    await user.click(await unhealthy());
    await user.click(tab(t('up.section.nodes')));
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await waitFor(() => expect(tab(t('up.section.health'))).toHaveAttribute('aria-selected', 'true'));
    expect(await unhealthy()).toHaveAttribute('aria-expanded', 'true');
    expect(writesOf(admin)).toEqual([]);
  });

  it('an upstream without nodes saves, as APISIX stores it; the Nodes tab says requests fail until one is added (Ruling 1)', async () => {
    const { user, admin } = await openEditor('#/upstreams/new?tab=nodes', { objects: { upstreams: [] } });
    expect(await main().findByText(t('up.nodes.emptyNote'))).toBeInTheDocument();
    expect(tab(t('up.section.nodes'))).toHaveAccessibleName(t('up.section.nodes'));
    await user.click(main().getByRole('button', { name: t('editor.create') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]).toEqual({ method: 'POST', path: 'upstreams', body: { type: 'roundrobin', nodes: [] } });
    // Locked after the create (it opens on General), the Nodes tab still says so.
    await main().findByText(t('editor.locked'));
    await user.click(tab(t('up.section.nodes')));
    expect(await main().findByText(t('up.nodes.emptyNote'))).toBeInTheDocument();
  });

  it('blocks Save on a problem and badges its tab', async () => {
    const { user, admin } = await openEditor('#/upstreams/web-pool', { objects: { upstreams: [{ ...POOL, type: 'chash' }] } });
    await main().findByRole('heading', { level: 1, name: 'web-pool' });
    await waitFor(() => expect(tab(/^Load balancing/)).toHaveAccessibleName(`${t('up.section.balancing')} ${t('ui.tabs.errors', { count: 1 })}`));
    await user.keyboard('e');
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    expect(getToasts().at(-1)?.message).toBe(t('editor.fixAnyway', { fix: t('editor.fixOne') }));
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

describe('fields holding input that is not in the draft', () => {
  const MAP: Obj = { id: 'm1', name: 'map-pool', type: 'roundrobin', nodes: { 'a.example:80': 1, 'b.example:80': 1, 'c.example:80': 1 } };
  const host = (n: number) => main().getByRole('textbox', { name: t('up.nodes.hostN', { n }) });

  it('a held duplicate address blocks Save, badges Nodes, and names the right node after a row above it goes', async () => {
    const { user, admin } = await openEditor('#/upstreams/m1?tab=nodes', { objects: { upstreams: [MAP] } });
    await main().findByRole('heading', { level: 1, name: 'map-pool' });
    await user.keyboard('e');
    await user.clear(await main().findByRole('textbox', { name: t('up.nodes.hostN', { n: 3 }) }));
    await user.type(host(3), 'b.example');
    expect(host(3)).toHaveAccessibleDescription(t('up.nodes.dupOf', { n: 2 }));
    expect(tab(t('up.section.nodes'))).toHaveAccessibleName(`${t('up.section.nodes')} ${t('ui.tabs.errors', { count: 1 })}`);

    await user.click(main().getByRole('button', { name: t('editor.save') }));
    const held = t('up.pending.duplicate', { node: t('up.pending.node', { n: 3 }), addr: 'b.example:80' });
    expect(getToasts().at(-1)?.message).toBe(t('editor.fixHeld', { fix: t('editor.fixOne'), message: held }));
    expect(writesOf(admin)).toEqual([]);

    await user.click(main().getByRole('button', { name: t('up.nodes.removeN', { n: 1 }) }));
    expect(host(2)).toHaveValue('b.example');
    expect(host(2)).toHaveAccessibleDescription(t('up.nodes.dupOf', { n: 1 }));

    // Changed to a free address, it is written, and Save goes through.
    await user.type(host(2), '2');
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body?.nodes).toEqual({ 'b.example:80': 1, 'b.example2:80': 1 });
  });

  it('Cmd/Ctrl-S writes an all-digit host still held in its field', async () => {
    const { user, admin } = await openEditor('#/upstreams/m1?tab=nodes', { objects: { upstreams: [{ ...MAP, nodes: { 'a.example': 1 } }] } });
    await main().findByRole('heading', { level: 1, name: 'map-pool' });
    await user.keyboard('e');
    await user.type(await main().findByRole('textbox', { name: t('up.nodes.new') }), '42');
    await user.keyboard('{Control>}s{/Control}');
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect(writesOf(admin)[0]?.body?.nodes).toEqual({ 'a.example': 1, 42: 1 });
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

describe('editing state ends with Save', () => {
  const TLS: Obj = { ...POOL, tls: { client_cert: 'CERT-1', client_key: 'KEY-1' } };

  it('a key typed after Replace, then a tab switch: "a new key was entered"; Keep the stored key puts the stored one back (not the typed one)', async () => {
    const { user, admin } = await openEditor('#/upstreams/web-pool?tab=tls', { objects: { upstreams: [TLS] } });
    await main().findByRole('heading', { level: 1, name: 'web-pool' });
    await user.keyboard('e');
    await user.click(await main().findByRole('button', { name: t('up.tls.replaceKey') }));
    await user.type(main().getByRole('textbox', { name: t('up.tls.key') }), 'KEY-2');
    await user.click(main().getByRole('tab', { name: /^General/ }));
    await user.click(main().getByRole('tab', { name: /^TLS/ }));
    expect(await main().findByText(t('up.tls.keyEntered'))).toBeInTheDocument();
    expect(screen.getByRole('main').textContent).not.toMatch(/KEY-[12]/);
    await user.click(main().getByRole('button', { name: t('up.tls.keepKey') }));
    expect(main().getByText(t('up.tls.keyStored'))).toBeInTheDocument();
    await user.click(main().getByRole('tab', { name: /^General/ }));
    await user.type(await main().findByRole('textbox', { name: /^Description/ }), '!');
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect((writesOf(admin)[0]?.body?.tls as Obj).client_key).toBe('KEY-1');
  });

  it('a replaced key: after Save and Edit, the stored-key view (no key text); Keep the stored key keeps the saved one, never the one before', async () => {
    const { user, admin } = await openEditor('#/upstreams/web-pool?tab=tls', { objects: { upstreams: [TLS] } });
    await main().findByRole('heading', { level: 1, name: 'web-pool' });
    await user.keyboard('e');
    await user.click(await main().findByRole('button', { name: t('up.tls.replaceKey') }));
    await user.type(main().getByRole('textbox', { name: t('up.tls.key') }), 'KEY-2');
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await waitFor(() => expect(writesOf(admin)).toHaveLength(1));
    expect((writesOf(admin)[0]?.body?.tls as Obj).client_key).toBe('KEY-2');
    await main().findByRole('button', { name: t('editor.edit') });

    await user.keyboard('e');
    expect(await main().findByText(t('up.tls.keyStored'))).toBeInTheDocument();
    expect(main().queryByRole('textbox', { name: t('up.tls.key') })).not.toBeInTheDocument();
    expect(screen.getByRole('main').textContent).not.toMatch(/KEY-[12]/);

    // Replace, then think better of it: the key kept is the stored one (KEY-2).
    await user.click(main().getByRole('button', { name: t('up.tls.replaceKey') }));
    await user.click(main().getByRole('button', { name: t('up.tls.keepKey') }));
    await user.click(main().getByRole('button', { name: t('editor.save') }));
    await main().findByRole('button', { name: t('editor.edit') });
    expect(getToasts().at(-1)?.message).toBe(t('editor.nothingToSave'));
    expect(writesOf(admin)).toHaveLength(1);
  });
});

