import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { isObj } from '../api/sanitize';
import type { Obj } from '../api/types';
import { t } from '../i18n';
import { editableControls } from '../test/schemaForm';
import { renderUpstream } from '../test/upstream';

const newHost = () => screen.getByRole('textbox', { name: t('up.nodes.new') });
const port = (n: number) => screen.getByRole('spinbutton', { name: t('up.nodes.portN', { n }) });
const host = (n: number) => screen.getByRole('textbox', { name: t('up.nodes.hostN', { n }) });
const weight = (n: number) => screen.getByRole('spinbutton', { name: t('up.nodes.weightN', { n }) });
/** Every value the form emitted had its nodes as a map. */
const allMaps = (changes: { mock: { calls: [Obj][] } }) => changes.mock.calls.every(([v]) => isObj(v.nodes));

describe('an empty node list (Ruling 1: APISIX stores it, so it is a note, not an issue)', () => {
  const note = () => screen.queryByText(t('up.nodes.emptyNote'));

  it.each([
    ['an empty list', { type: 'roundrobin', nodes: [] }],
    ['an empty map', { nodes: {} }],
  ])('%s: a warning note, editing and locked', (_, up) => {
    const h = renderUpstream(up, { section: 'nodes' });
    expect(note()).toBeInTheDocument();
    expect(note()).toHaveClass('up-warn');
    h.update({ locked: true });
    expect(note()).toBeInTheDocument();
  });

  it('no note once a node is there, with service discovery, or with no node list at all', async () => {
    const h = renderUpstream({ nodes: [] }, { section: 'nodes' });
    await h.user.type(newHost(), 'web.internal');
    expect(note()).not.toBeInTheDocument();
    h.unmount();
    renderUpstream({ discovery_type: 'consul', service_name: 'web' }, { section: 'nodes' }).unmount();
    expect(note()).not.toBeInTheDocument();
    renderUpstream({}, { section: 'nodes' });
    expect(note()).not.toBeInTheDocument();
  });
});

describe('the node list', () => {
  it('keeps a loaded map shape when a node is added', async () => {
    const h = renderUpstream({ type: 'roundrobin', nodes: { '10.0.0.1:80': 1, '10.0.0.2:80': 2 } }, { section: 'nodes' });
    await h.user.type(newHost(), '10.0.0.3');
    await h.user.type(port(3), '8080');
    expect(h.value().nodes).toEqual({ '10.0.0.1:80': 1, '10.0.0.2:80': 2, '10.0.0.3:8080': 1 });
  });

  it('keeps a loaded array shape when a node is added', async () => {
    const h = renderUpstream({ nodes: [{ host: '10.0.0.1', port: 80, weight: 1 }] }, { section: 'nodes' });
    await h.user.type(newHost(), '10.0.0.3');
    await h.user.type(port(2), '8080');
    expect(h.value().nodes).toEqual([
      { host: '10.0.0.1', port: 80, weight: 1 },
      { host: '10.0.0.3', port: 8080, weight: 1 },
    ]);
  });

  it('writes the array shape for a new upstream; the typed host keeps focus as its row appears', async () => {
    const h = renderUpstream({ type: 'roundrobin', nodes: [] }, { section: 'nodes' });
    const input = newHost();
    await h.user.type(input, 'web.internal');
    expect(input).toHaveFocus();
    expect(input).toHaveAccessibleName(t('up.nodes.hostN', { n: 1 }));
    expect(h.value().nodes).toEqual([{ host: 'web.internal', weight: 1 }]);
    // A fresh new-node row waits below.
    expect(newHost()).toHaveValue('');
  });

  it('turns map-shaped nodes into the array shape when a priority is set, keeping the weights', async () => {
    const h = renderUpstream({ nodes: { '10.0.0.1:80': 3, '10.0.0.2:80': 1 } }, { section: 'nodes' });
    await h.user.type(screen.getByRole('spinbutton', { name: t('up.nodes.priorityN', { n: 2 }) }), '-1');
    expect(h.value().nodes).toEqual([
      { host: '10.0.0.1', port: 80, weight: 3 },
      { host: '10.0.0.2', port: 80, weight: 1, priority: -1 },
    ]);
  });

  it('adds a row per line when host:port lines are pasted', async () => {
    const h = renderUpstream({ nodes: [] }, { section: 'nodes' });
    await h.user.click(newHost());
    await h.user.paste('10.0.0.1:80\n10.0.0.2:8080');
    expect(h.value().nodes).toEqual([
      { host: '10.0.0.1', port: 80, weight: 1 },
      { host: '10.0.0.2', port: 8080, weight: 1 },
    ]);
    expect(screen.getByRole('textbox', { name: t('up.nodes.hostN', { n: 2 }) })).toHaveValue('10.0.0.2');
  });

  it('duplicates and removes rows', async () => {
    const h = renderUpstream({ nodes: [{ host: 'a', port: 1, weight: 1 }, { host: 'b', port: 2, weight: 1 }] }, { section: 'nodes' });
    await h.user.click(screen.getByRole('button', { name: t('up.nodes.duplicateN', { n: 1 }) }));
    expect(h.value().nodes).toEqual([
      { host: 'a', port: 1, weight: 1 },
      { host: 'a', port: 1, weight: 1 },
      { host: 'b', port: 2, weight: 1 },
    ]);
    await h.user.click(screen.getByRole('button', { name: t('up.nodes.removeN', { n: 1 }) }));
    await h.user.click(screen.getByRole('button', { name: t('up.nodes.removeN', { n: 1 }) }));
    await h.user.click(screen.getByRole('button', { name: t('up.nodes.removeN', { n: 1 }) }));
    // The list stays, empty, while it is being edited (upstreamIssues asks for a node).
    expect(h.value().nodes).toEqual([]);
  });

  it('shows the issues of a row on its fields', () => {
    renderUpstream({ nodes: [{ port: 80, weight: 1 }] }, { section: 'nodes', issues: [{ path: 'nodes.0.host', message: 'Enter a host' }] });
    expect(screen.getByRole('textbox', { name: t('up.nodes.hostN', { n: 1 }) })).toHaveAccessibleDescription('Enter a host');
  });

  it('reads as a plain table when locked, with each node’s share of requests', () => {
    const h = renderUpstream(
      { type: 'roundrobin', nodes: [{ host: '10.0.0.1', port: 80, weight: 3 }, { host: '10.0.0.2', port: 80, weight: 1 }, { host: 'dr.example', port: 80, weight: 1, priority: -1 }] },
      { section: 'nodes', locked: true },
    );
    expect(editableControls(h.container)).toEqual([]);
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows.map((r) => r.textContent)).toEqual([
      `${t('up.nodes.host')}${t('up.nodes.port')}${t('up.nodes.weight')}${t('up.nodes.priority')}${t('up.nodes.share')}`,
      '10.0.0.1803075%',
      '10.0.0.2801025%',
      `dr.example801-1${t('up.nodes.standby')}`,
    ]);
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('leaves the priority column out of a locked table when no node sets one', () => {
    renderUpstream({ type: 'least_conn', nodes: { 'a.example:80': 1 } }, { section: 'nodes', locked: true });
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    // least_conn does not split requests by weight: no share column either.
    expect(rows.map((r) => r.textContent)).toEqual([`${t('up.nodes.host')}${t('up.nodes.port')}${t('up.nodes.weight')}`, 'a.example801']);
  });
});

// Task 16b item 45, as ruled in fix round 1 (F3/F4): leaving a host field changes nothing; a host
// holding a port says so and offers to move it; "Add a node" takes host:port on Enter; a map can't hold a
// stray colon, so it is held until changed or its port moved; a bare IPv6 address is taken, shown as typed.
describe('host:port typed by hand', () => {
  const move = (n: number, port: number) => screen.getByRole('button', { name: t('up.nodes.movePortN', { port, n }) });

  it('a host cell (an array): the text is the host as typed; leaving changes nothing; a hint, and Move <port> to Port sets both', async () => {
    const h = renderUpstream({ nodes: [{ host: 'a', port: 80, weight: 3, metadata: { m: 1 } }] }, { section: 'nodes' });
    await h.user.clear(host(1));
    await h.user.type(host(1), '10.0.0.5:8080');
    await h.user.tab();
    expect(h.value().nodes).toEqual([{ host: '10.0.0.5:8080', port: 80, weight: 3, metadata: { m: 1 } }]);
    expect(host(1)).toHaveValue('10.0.0.5:8080');
    expect(host(1)).toHaveAccessibleDescription(t('up.nodes.hostHasPort', { port: 8080 }));
    expect(host(1)).not.toHaveAttribute('aria-invalid');
    expect(h.held()).toEqual([]);
    await h.user.click(move(1, 8080));
    expect(h.value().nodes).toEqual([{ host: '10.0.0.5', port: 8080, weight: 3, metadata: { m: 1 } }]);
    expect(port(1)).toHaveValue('8080');
  });

  it('a host cell (an array): another stray colon gets its own hint; an IPv6 address, bare or bracketed, none', async () => {
    const h = renderUpstream({ nodes: [{ host: 'a', port: 80, weight: 1 }] }, { section: 'nodes' });
    for (const [text, hint] of [
      ['10.0.0.5:', t('up.nodes.hostColon')],
      ['10.0.0.5:abc', t('up.nodes.hostColon')],
      ['fe80::1', undefined],
      ['[[fe80::1]', undefined],
    ] as const) {
      await h.user.clear(host(1));
      await h.user.type(host(1), text);
      await h.user.tab();
      if (hint) expect(host(1), text).toHaveAccessibleDescription(hint);
      else expect(host(1), text).not.toHaveAccessibleDescription();
    }
    expect(h.value().nodes).toEqual([{ host: '[fe80::1]', port: 80, weight: 1 }]);
  });

  it('a stored array host holding a port: focus in and out changes nothing; the hint and Move are there', async () => {
    const h = renderUpstream({ nodes: [{ host: '10.0.0.5:8080', port: 80, weight: 1 }, { host: 'fe80::1', weight: 1 }] }, { section: 'nodes' });
    await h.user.click(host(1));
    await h.user.tab();
    expect(h.changes).not.toHaveBeenCalled();
    expect(host(1)).toHaveValue('10.0.0.5:8080');
    expect(port(1)).toHaveValue('80');
    expect(host(1)).toHaveAccessibleDescription(t('up.nodes.hostHasPort', { port: 8080 }));
    expect(move(1, 8080)).toBeInTheDocument();
    expect(host(2)).not.toHaveAccessibleDescription();
  });

  it('a map host cell: a stray colon is held, through leaving the field, until changed or its port moved', async () => {
    const h = renderUpstream({ type: 'roundrobin', nodes: { 'a:80': 2, 'b:80': 1 } }, { section: 'nodes' });
    await h.user.clear(host(1));
    await h.user.type(host(1), '10.0.0.5:');
    await h.user.tab();
    expect(host(1)).toHaveValue('10.0.0.5:');
    expect(host(1)).toHaveAttribute('aria-invalid', 'true');
    expect(h.held()).toEqual([t('up.pending.unsaved', { node: t('up.pending.node', { n: 1 }), addr: '10.0.0.5:' })]);
    expect(Object.keys(h.value().nodes as Obj).some((key) => key.includes('['))).toBe(false);
    await h.user.type(host(1), '8080');
    await h.user.tab();
    expect(host(1)).toHaveValue('10.0.0.5:8080');
    expect(h.held()).toHaveLength(1);
    await h.user.click(move(1, 8080));
    expect(h.value().nodes).toEqual({ '10.0.0.5:8080': 2, 'b:80': 1 });
    expect(h.held()).toEqual([]);
    expect(host(1)).toHaveValue('10.0.0.5');
    expect(port(1)).toHaveValue('8080');
  });

  it('a map host cell: a bare IPv6 address is taken (bracketed in the key) and keeps showing as typed', async () => {
    const h = renderUpstream({ type: 'roundrobin', nodes: { 'a:80': 2, 'b:80': 1 } }, { section: 'nodes' });
    await h.user.clear(host(1));
    await h.user.type(host(1), 'fe80::1');
    await h.user.tab();
    expect(h.value().nodes).toEqual({ '[fe80::1]:80': 2, 'b:80': 1 });
    expect(host(1)).toHaveValue('fe80::1');
    expect(h.held()).toEqual([]);
    // Fix round 2, R1.2: a port edit keeps the host as typed.
    await h.user.clear(port(1));
    await h.user.type(port(1), '81');
    await h.user.tab();
    expect(h.value().nodes).toEqual({ '[fe80::1]:81': 2, 'b:80': 1 });
    expect(host(1)).toHaveValue('fe80::1');
  });

  it('"Add a node" of a map: Enter adds host:port as a paste reads it; leaving keeps it held', async () => {
    const h = renderUpstream({ type: 'roundrobin', nodes: { 'a:80': 2 } }, { section: 'nodes' });
    await h.user.type(newHost(), '10:9090');
    await h.user.tab();
    expect(newHost()).toHaveValue('10:9090');
    expect(h.held()).toEqual([t('up.pending.unsaved', { node: t('up.pending.newNode'), addr: '10:9090' })]);
    await h.user.click(newHost());
    await h.user.keyboard('{Enter}');
    expect(h.value().nodes).toEqual({ 'a:80': 2, '10:9090': 1 });
    expect(h.held()).toEqual([]);
  });

  // Fix round 2, ruling point 2: Enter in a host field holding `host:port` does what "Move <port> to Port" does.
  it('"Add a node" with 10.0.0.5:8080, then Enter (an array): a node at host 10.0.0.5, port 8080', async () => {
    const h = renderUpstream({ type: 'roundrobin', nodes: [{ host: 'a', port: 80, weight: 1 }] }, { section: 'nodes' });
    await h.user.type(newHost(), '10.0.0.5:8080');
    expect(h.value().nodes).toEqual([{ host: 'a', port: 80, weight: 1 }, { host: '10.0.0.5:8080', weight: 1 }]);
    const writes = h.changes.mock.calls.length;
    await h.user.keyboard('{Enter}');
    expect(h.value().nodes).toEqual([{ host: 'a', port: 80, weight: 1 }, { host: '10.0.0.5', port: 8080, weight: 1 }]);
    expect(h.changes.mock.calls.length).toBe(writes + 1);
  });

  it('"Add a node" with 10.0.0.5:8080, then Enter (a map): the entry 10.0.0.5:8080', async () => {
    const h = renderUpstream({ type: 'roundrobin', nodes: { 'a:80': 2 } }, { section: 'nodes' });
    await h.user.type(newHost(), '10.0.0.5:8080');
    expect(h.held()).toHaveLength(1);
    await h.user.keyboard('{Enter}');
    expect(h.value().nodes).toEqual({ 'a:80': 2, '10.0.0.5:8080': 1 });
    expect(h.held()).toEqual([]);
  });

  it("Enter in a stored row's host holding a port moves it; Enter in a host without one changes nothing", async () => {
    const h = renderUpstream({ nodes: [{ host: '10.0.0.5:8080', port: 80, weight: 1 }, { host: 'b', port: 80, weight: 1 }] }, { section: 'nodes' });
    await h.user.click(host(1));
    await h.user.keyboard('{Enter}');
    expect(h.value().nodes).toEqual([{ host: '10.0.0.5', port: 8080, weight: 1 }, { host: 'b', port: 80, weight: 1 }]);
    const writes = h.changes.mock.calls.length;
    await h.user.click(host(2));
    await h.user.keyboard('{Enter}');
    expect(h.changes.mock.calls.length).toBe(writes);
  });

  it('a paste of host:port into a host cell splits at once, as before', async () => {
    const h = renderUpstream({ nodes: [{ host: 'a', port: 80, weight: 1 }] }, { section: 'nodes' });
    await h.user.clear(host(1));
    await h.user.click(host(1));
    await h.user.paste('10.0.0.7:7070');
    expect(h.value().nodes).toEqual([{ host: '10.0.0.7', port: 7070, weight: 1 }]);
  });
});

describe('map-shaped nodes stay a map through edits', () => {
  const MAP = { type: 'roundrobin', nodes: { '10.0.0.1:80': 1, '10.0.0.2:80': 2 } };

  it('clearing and retyping a host', async () => {
    const h = renderUpstream(MAP, { section: 'nodes' });
    await h.user.clear(host(1));
    // An empty host stays in its row (upstreamIssues asks for one before saving).
    expect(h.value().nodes).toEqual({ ':80': 1, '10.0.0.2:80': 2 });
    await h.user.type(host(1), '10.0.0.9');
    expect(h.value().nodes).toEqual({ '10.0.0.9:80': 1, '10.0.0.2:80': 2 });
    expect(Object.keys(h.value().nodes as Obj)).toEqual(['10.0.0.9:80', '10.0.0.2:80']);
    expect(allMaps(h.changes)).toBe(true);
  });

  it('clearing and retyping a weight', async () => {
    const h = renderUpstream(MAP, { section: 'nodes' });
    await h.user.clear(weight(2));
    expect(h.value().nodes).toEqual({ '10.0.0.1:80': 1, '10.0.0.2:80': null });
    expect(weight(2)).toHaveValue('');
    await h.user.type(weight(2), '7');
    expect(h.value().nodes).toEqual({ '10.0.0.1:80': 1, '10.0.0.2:80': 7 });
    expect(allMaps(h.changes)).toBe(true);
  });

  it('clearing a port, and a priority of 0, keep the map', async () => {
    const h = renderUpstream(MAP, { section: 'nodes' });
    await h.user.clear(port(1));
    await h.user.type(screen.getByRole('spinbutton', { name: t('up.nodes.priorityN', { n: 2 }) }), '0');
    expect(h.value().nodes).toEqual({ '10.0.0.1': 1, '10.0.0.2:80': 2 });
    expect(allMaps(h.changes)).toBe(true);
  });

  it('holds an all-digit host in its field while typing, and commits it on blur', async () => {
    const h = renderUpstream({ nodes: { 'a.example': 1, 'b.example': 2 } }, { section: 'nodes' });
    await h.user.clear(host(2));
    await h.user.type(host(2), '10');
    expect(host(2)).toHaveValue('10');
    expect(h.value().nodes).toEqual({ 'a.example': 1, '': 2 });
    await h.user.tab();
    // Committed, not dropped (JavaScript lists the all-digit key first).
    expect(h.value().nodes).toEqual({ 'a.example': 1, 10: 2 });
    expect(host(1)).toHaveValue('10');
    expect(allMaps(h.changes)).toBe(true);
  });

  it('commits an all-digit host typed as a new node on blur', async () => {
    const h = renderUpstream({ nodes: { 'a.example': 1 } }, { section: 'nodes' });
    await h.user.type(newHost(), '42');
    expect(h.value().nodes).toEqual({ 'a.example': 1 });
    await h.user.tab();
    expect(h.value().nodes).toEqual({ 'a.example': 1, 42: 1 });
  });

  it('flags an address already in the list and keeps both entries as they were until told to keep both', async () => {
    const h = renderUpstream(MAP, { section: 'nodes' });
    await h.user.clear(host(2));
    await h.user.type(host(2), '10.0.0.1');
    // Held in the field: node 2 keeps its address from before the edit; node 1 is untouched.
    expect(h.value().nodes).toEqual(MAP.nodes);
    expect(host(2)).toHaveValue('10.0.0.1');
    expect(host(2)).toHaveAccessibleDescription(t('up.nodes.dupOf', { n: 1 }));
    await h.user.tab();
    expect(host(2)).toHaveValue('10.0.0.1');
    expect(h.value().nodes).toEqual(MAP.nodes);

    await h.user.click(screen.getByRole('button', { name: t('up.nodes.keepBothN', { n: 2 }) }));
    expect(h.value().nodes).toEqual([
      { host: '10.0.0.1', port: 80, weight: 1 },
      { host: '10.0.0.1', port: 80, weight: 2 },
    ]);
  });

  it('commits a held duplicate once it is changed to a free address', async () => {
    const h = renderUpstream(MAP, { section: 'nodes' });
    await h.user.clear(host(2));
    await h.user.type(host(2), '10.0.0.1');
    await h.user.type(host(2), '1');
    expect(h.value().nodes).toEqual({ '10.0.0.1:80': 1, '10.0.0.11:80': 2 });
    expect(host(2)).not.toHaveAccessibleDescription(t('up.nodes.dupOf', { n: 1 }));
    expect(allMaps(h.changes)).toBe(true);
  });

  it('flags a new node at an address already in the list, adding nothing', async () => {
    const h = renderUpstream({ nodes: { 'a.example': 1 } }, { section: 'nodes' });
    await h.user.type(newHost(), 'a.example');
    expect(h.value().nodes).toEqual({ 'a.example': 1 });
    expect(newHost()).toHaveAccessibleDescription(t('up.nodes.dupOf', { n: 1 }));
    await h.user.click(screen.getByRole('button', { name: t('up.nodes.keepBothNew') }));
    expect(h.value().nodes).toEqual([{ host: 'a.example', weight: 1 }, { host: 'a.example', weight: 1 }]);
  });

  it('Duplicate copies the port and weight into a row with an empty host', async () => {
    const h = renderUpstream(MAP, { section: 'nodes' });
    await h.user.click(screen.getByRole('button', { name: t('up.nodes.duplicateN', { n: 1 }) }));
    expect(h.value().nodes).toEqual({ '10.0.0.1:80': 1, ':80': 1, '10.0.0.2:80': 2 });
    expect(Object.keys(h.value().nodes as Obj)).toEqual(['10.0.0.1:80', ':80', '10.0.0.2:80']);
    // A second copy would need the same empty address.
    expect(screen.getByRole('button', { name: t('up.nodes.duplicateN', { n: 1 }) })).toBeDisabled();
  });

  it('a paste adds the new addresses and names the ones already in the list', async () => {
    const h = renderUpstream(MAP, { section: 'nodes' });
    await h.user.click(newHost());
    await h.user.paste('10.0.0.1:80\n10.0.0.3:80');
    expect(h.value().nodes).toEqual({ '10.0.0.1:80': 1, '10.0.0.2:80': 2, '10.0.0.3:80': 1 });
    expect(screen.getByText(t('up.nodes.skipped', { list: '10.0.0.1:80' }))).toBeInTheDocument();
  });
});

describe('service discovery', () => {
  it('switching to discovery removes the nodes, and switching back removes the discovery fields', async () => {
    const h = renderUpstream({ type: 'roundrobin', nodes: [{ host: 'a', port: 1, weight: 1 }], x_future: 1 }, { section: 'nodes' });
    await h.user.click(screen.getByRole('radio', { name: t('up.target.discovery') }));
    expect(h.value()).toEqual({ type: 'roundrobin', x_future: 1 });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    await h.user.type(screen.getByRole('combobox', { name: t('up.discovery.type') }), 'consul');
    await h.user.type(screen.getByRole('textbox', { name: t('up.discovery.service') }), 'web');
    expect(h.value()).toEqual({ type: 'roundrobin', x_future: 1, discovery_type: 'consul', service_name: 'web' });

    await h.user.click(screen.getByRole('radio', { name: t('up.target.nodes') }));
    expect(h.value()).toEqual({ type: 'roundrobin', x_future: 1, nodes: [] });
  });

  it('shows the nacos arguments for nacos and keeps other arguments as key-value pairs', async () => {
    const h = renderUpstream(
      { discovery_type: 'nacos', service_name: 'users', discovery_args: { namespace_id: 'dev', weird: 'x', nested: { a: 1 } } },
      { section: 'nodes' },
    );
    expect(screen.getByRole('radio', { name: t('up.target.discovery') })).toBeChecked();
    expect(screen.getByRole('textbox', { name: t('up.discovery.namespace') })).toHaveValue('dev');
    await h.user.type(screen.getByRole('textbox', { name: t('up.discovery.group') }), 'G');
    expect(h.value().discovery_args).toEqual({ namespace_id: 'dev', group_name: 'G', weird: 'x', nested: { a: 1 } });
    expect(screen.getByText(t('up.discovery.unshown', { keys: 'nested' }))).toBeInTheDocument();
  });
});

describe('held node text and the lock', () => {
  it('drops held text when the editor locks, so it cannot come back on the next Edit', async () => {
    const h = renderUpstream({ nodes: { '10.0.0.1:80': 1, '10.0.0.2:80': 2 } }, { section: 'nodes' });
    await h.user.clear(host(2));
    await h.user.type(host(2), '10.0.0.1');
    expect(host(2)).toHaveValue('10.0.0.1');
    h.update({ locked: true });
    h.update({ locked: false });
    expect(host(2)).toHaveValue('10.0.0.2');
    expect(h.value().nodes).toEqual({ '10.0.0.1:80': 1, '10.0.0.2:80': 2 });
  });
});
