import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { editableControls } from '../test/schemaForm';
import { renderUpstream } from '../test/upstream';

const newHost = () => screen.getByRole('textbox', { name: t('up.nodes.new') });
const port = (n: number) => screen.getByRole('spinbutton', { name: t('up.nodes.portN', { n }) });

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
