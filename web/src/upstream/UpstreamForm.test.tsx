import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Obj } from '../api/types';
import { t } from '../i18n';
import { ctxOf, itemOf } from '../test/ctx';
import { editableControls } from '../test/schemaForm';
import { renderUpstream } from '../test/upstream';

/** The accessible name of a field marked required. */
const req = (label: string) => `${label} (${t('ui.required')})`;

const toggle = (label: string) => screen.getByRole('button', { name: label });

/** An upstream that sets something in every section, with a key no form models. */
const FULL: Obj = {
  type: 'chash',
  hash_on: 'header',
  key: 'X-User-Id',
  nodes: [
    { host: '10.0.0.11', port: 8080, weight: 3 },
    { host: '10.0.0.12', port: 8080, weight: 1, priority: -1 },
  ],
  checks: {
    active: { type: 'http', http_path: '/health', healthy: { interval: 2, successes: 2 }, unhealthy: { http_failures: 3 }, req_headers: ['User-Agent: probe'] },
    passive: { unhealthy: { http_statuses: [500, 503] } },
  },
  scheme: 'https',
  retries: 2,
  retry_timeout: 5,
  timeout: { connect: 3, send: 10, read: 10 },
  keepalive_pool: { size: 64, idle_timeout: 30, requests: 500 },
  pass_host: 'rewrite',
  upstream_host: 'api.internal',
  tls: { verify: true, client_cert_id: 'c1' },
  x_future: { kept: true },
};
const CTX = ctxOf({ ssls: [itemOf('c1', { type: 'client', name: 'mtls-client' })] });

describe('UpstreamForm, inline sections', () => {
  it('opens Nodes; the others start collapsed with their summary unless they hold a value', () => {
    renderUpstream({ type: 'roundrobin', nodes: [{ host: 'a', port: 1, weight: 1 }], timeout: { connect: 1, send: 2, read: 3 } });
    expect(toggle(t('up.section.nodes'))).toHaveAttribute('aria-expanded', 'true');
    expect(toggle(t('up.section.balancing'))).toHaveAttribute('aria-expanded', 'false');
    expect(toggle(t('up.section.balancing'))).toHaveAccessibleDescription('Round robin');
    expect(toggle(t('up.section.health'))).toHaveAccessibleDescription(t('ui.off'));
    expect(toggle(t('up.section.connection'))).toHaveAttribute('aria-expanded', 'true');
    expect(toggle(t('up.section.tls'))).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens a section that holds an issue and counts it', () => {
    renderUpstream({ nodes: [{ host: 'a', weight: 1 }], pass_host: 'rewrite' }, { issues: [{ path: 'upstream_host', message: 'Enter the host' }] });
    const connection = toggle(t('up.section.connection'));
    expect(connection).toHaveAttribute('aria-expanded', 'true');
    expect(within(connection.closest('section') as HTMLElement).getByText(t('ui.tabs.errors', { count: 1 }))).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: req(t('up.conn.upstreamHost')) })).toHaveAccessibleDescription('Enter the host');
  });

  it('shows issues about the upstream as a whole above the sections', () => {
    renderUpstream({ nodes: [] }, { issues: [{ path: '', message: 'APISIX says no' }] });
    expect(screen.getByRole('alert')).toHaveTextContent('APISIX says no');
  });

  it('keeps a key no form models through an edit in every section', async () => {
    const h = renderUpstream(FULL, { ctx: CTX });
    await h.user.type(screen.getByRole('spinbutton', { name: t('up.nodes.weightN', { n: 1 }) }), '0');
    await h.user.clear(screen.getByRole('textbox', { name: req(t('up.balance.key')) }));
    await h.user.type(screen.getByRole('textbox', { name: req(t('up.balance.key')) }), 'X-Org');
    await h.user.click(screen.getByRole('switch', { name: t('up.hc.passive') }));
    await h.user.type(screen.getByRole('spinbutton', { name: t('up.conn.retries') }), '3');
    await h.user.click(screen.getByRole('radio', { name: t('up.tls.mode.none') }));
    const v = h.value();
    expect(v.x_future).toEqual({ kept: true });
    expect((v.nodes as Obj[])[0]?.weight).toBe(30);
    expect(v.key).toBe('X-Org');
    expect(v.checks).toEqual({ active: (FULL.checks as Obj).active });
    expect(v.retries).toBe(23);
    expect(v.tls).toEqual({ verify: true });
  });

  it('renders no form controls when locked, and reads as values', () => {
    const h = renderUpstream(FULL, { ctx: CTX, locked: true });
    expect(editableControls(h.container)).toEqual([]);
    expect(screen.queryAllByRole('switch')).toEqual([]);
    expect(screen.queryAllByRole('combobox')).toEqual([]);
    expect(screen.queryAllByRole('radio')).toEqual([]);
    expect(screen.getByText('10.0.0.11')).toBeInTheDocument();
    expect(screen.getByText('X-User-Id')).toBeInTheDocument();
    expect(screen.getByText('/health')).toBeInTheDocument();
    expect(screen.getByText('api.internal')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'mtls-client' })).toBeInTheDocument();
  });
});

describe('UpstreamForm, tabs', () => {
  it('puts each section in a tab of its own', async () => {
    const h = renderUpstream({ type: 'roundrobin', nodes: [{ host: 'a', port: 1, weight: 1 }] }, { layout: 'tabs' });
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      t('up.section.nodes'),
      t('up.section.balancing'),
      t('up.section.health'),
      t('up.section.connection'),
      t('up.section.tls'),
    ]);
    await h.user.click(screen.getByRole('tab', { name: t('up.section.connection') }));
    expect(screen.getByRole('spinbutton', { name: t('up.conn.connect') })).toBeInTheDocument();
  });
});
