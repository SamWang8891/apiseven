// The balancing, health, connection and TLS sections, each rendered as its standalone tab renders it.
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Obj } from '../api/types';
import { t } from '../i18n';
import { ctxOf, itemOf } from '../test/ctx';
import { renderUpstream } from '../test/upstream';

/** The accessible name of a field marked required. */
const req = (label: string) => `${label} (${t('ui.required')})`;

async function choose(user: ReturnType<typeof renderUpstream>['user'], combobox: string, option: string | RegExp) {
  await user.click(screen.getByRole('combobox', { name: combobox }));
  await user.click(await screen.findByRole('option', { name: option }));
}

describe('load balancing', () => {
  it('shows hash_on and key only for chash; switching away removes both', async () => {
    const h = renderUpstream({ type: 'roundrobin', nodes: [] }, { section: 'balancing' });
    expect(screen.queryByRole('combobox', { name: t('up.balance.hashOn') })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: req(t('up.balance.key')) })).not.toBeInTheDocument();

    await choose(h.user, t('up.balance.type'), t('up.balance.chash'));
    await choose(h.user, t('up.balance.hashOn'), 'header');
    await h.user.type(screen.getByRole('textbox', { name: req(t('up.balance.key')) }), 'X-User-Id');
    expect(h.value()).toEqual({ type: 'chash', hash_on: 'header', key: 'X-User-Id', nodes: [] });
    expect(screen.getByRole('textbox', { name: req(t('up.balance.key')) })).toHaveAccessibleDescription(t('up.balance.keyHelp.header'));

    await choose(h.user, t('up.balance.type'), t('up.balance.roundrobin'));
    expect(h.value()).toEqual({ type: 'roundrobin', nodes: [] });
  });

  it('turns slow start on and off for round robin', async () => {
    const h = renderUpstream({ type: 'roundrobin' }, { section: 'balancing' });
    await h.user.click(screen.getByRole('switch', { name: t('up.warm.title') }));
    await h.user.type(screen.getByRole('spinbutton', { name: req(t('up.warm.slowStart')) }), '30');
    await h.user.type(screen.getByRole('spinbutton', { name: req(t('up.warm.minWeight')) }), '10');
    expect(h.value()).toEqual({ type: 'roundrobin', warm_up_conf: { slow_start_time_seconds: 30, min_weight_percent: 10 } });
    await h.user.click(screen.getByRole('switch', { name: t('up.warm.title') }));
    expect(h.value()).toEqual({ type: 'roundrobin' });
  });
});

describe('health checks', () => {
  // Task 16b item 45: what an active probe's type hides is not kept behind it (schema_def.lua 150-234: none is required,
  // each has a default). Fix round 1, F5: the passive block keeps its HTTP values, which APISIX reads on HTTP routes whatever the type.
  it('switching the active probe to tcp removes what only http(s) reads; to http, the https certificate check; passive keeps its values', async () => {
    const h = renderUpstream(
      {
        checks: {
          active: {
            type: 'https', http_path: '/h', http_method: 'POST', http_req_body: 'x', req_headers: ['A: b'], https_verify_certificate: false, host: 'h.test',
            healthy: { interval: 2, http_statuses: [200] }, unhealthy: { http_failures: 3, tcp_failures: 2, http_statuses: [500] },
          },
          passive: { healthy: { http_statuses: [200], successes: 3 }, unhealthy: { http_failures: 2, timeouts: 4, http_statuses: [503] } },
        },
      },
      { section: 'health' },
    );
    const types = () => screen.getAllByRole('combobox', { name: new RegExp(`^${t('up.hc.type')}`) });
    await h.user.click(types()[0] as HTMLElement);
    await h.user.click(await screen.findByRole('option', { name: 'http' }));
    expect((h.value().checks as Obj).active).toEqual({
      type: 'http', http_path: '/h', http_method: 'POST', http_req_body: 'x', req_headers: ['A: b'], host: 'h.test',
      healthy: { interval: 2, http_statuses: [200] }, unhealthy: { http_failures: 3, tcp_failures: 2, http_statuses: [500] },
    });
    await h.user.click(types()[0] as HTMLElement);
    await h.user.click(await screen.findByRole('option', { name: 'tcp' }));
    expect((h.value().checks as Obj).active).toEqual({ type: 'tcp', host: 'h.test', healthy: { interval: 2 }, unhealthy: { tcp_failures: 2 } });
    await h.user.click(types()[1] as HTMLElement);
    await h.user.click(await screen.findByRole('option', { name: 'tcp' }));
    expect((h.value().checks as Obj).passive).toEqual({
      type: 'tcp',
      healthy: { http_statuses: [200], successes: 3 },
      unhealthy: { http_failures: 2, timeouts: 4, http_statuses: [503] },
    });
    // The open sections show them, with the line that says they still count.
    const passive = screen.getByRole('group', { name: t('up.hc.passive') });
    expect(within(passive).getByText(t('up.hc.passiveTcpHttp'))).toBeInTheDocument();
  });

  it('turning active checks off removes checks.active, and checks once empty', async () => {
    const h = renderUpstream({ checks: { active: { http_path: '/health' } } }, { section: 'health' });
    expect(screen.getByRole('textbox', { name: t('up.hc.path') })).toHaveValue('/health');
    await h.user.click(screen.getByRole('switch', { name: t('up.hc.active') }));
    expect(h.value()).toEqual({});
  });

  it('offers passive checks only with active ones; turning active off removes checks entirely', async () => {
    const h = renderUpstream({ x_future: 1 }, { section: 'health' });
    expect(screen.getByRole('switch', { name: t('up.hc.passive') })).toBeDisabled();

    await h.user.click(screen.getByRole('switch', { name: t('up.hc.active') }));
    expect(h.value()).toEqual({ x_future: 1, checks: { active: {} } });
    await h.user.click(screen.getByRole('switch', { name: t('up.hc.passive') }));
    expect(h.value()).toEqual({ x_future: 1, checks: { active: {}, passive: {} } });

    const passive = screen.getByRole('group', { name: t('up.hc.passive') });
    // "Count as unhealthy" is a closed section at first: opened as a user would.
    await h.user.click(within(passive).getByRole('button', { name: t('up.hc.passiveUnhealthy') }));
    await h.user.type(within(passive).getByRole('spinbutton', { name: t('up.hc.httpFailures') }), '3');
    expect(h.value().checks).toEqual({ active: {}, passive: { unhealthy: { http_failures: 3 } } });

    await h.user.click(screen.getByRole('switch', { name: t('up.hc.active') }));
    expect(h.value()).toEqual({ x_future: 1 });
  });

  it('clearing a probe field keeps active checks on', async () => {
    const h = renderUpstream({ checks: { active: { http_path: '/h' } } }, { section: 'health' });
    await h.user.clear(screen.getByRole('textbox', { name: t('up.hc.path') }));
    expect(h.value()).toEqual({ checks: { active: {} } });
  });

  it('edits status lists as numbers', async () => {
    const h = renderUpstream({ checks: { active: {} } }, { section: 'health' });
    await h.user.click(screen.getByRole('button', { name: t('up.hc.healthy') }));
    const healthy = screen.getByRole('region', { name: t('up.hc.healthy') });
    await h.user.type(within(healthy).getByRole('textbox', { name: t('up.hc.statuses') }), '200,204,');
    expect(h.value().checks).toEqual({ active: { healthy: { http_statuses: [200, 204] } } });
  });

  // Fix round 1, R1: the groups are collapsible sections with a one-line summary.
  describe('collapsible sections', () => {
    const toggle = (name: string) => screen.getByRole('button', { name });
    const CHECKS = {
      active: { type: 'http', http_path: '/healthz', timeout: 2, healthy: { interval: 2, successes: 2 }, unhealthy: { interval: 1, http_failures: 3, timeouts: 3 } },
      passive: { healthy: { successes: 4 }, unhealthy: { http_statuses: [500, 503] } },
    };

    it('the probe opens, the "Mark … after" and passive sections start closed with what is set in one line', () => {
      renderUpstream({ checks: CHECKS }, { section: 'health' });
      expect(toggle(t('up.hc.probe'))).toHaveAttribute('aria-expanded', 'true');
      for (const name of ['up.hc.healthy', 'up.hc.unhealthy', 'up.hc.passiveHealthy', 'up.hc.passiveUnhealthy']) {
        expect(toggle(t(name)), name).toHaveAttribute('aria-expanded', 'false');
      }
      expect(toggle(t('up.hc.healthy'))).toHaveAccessibleDescription('every 2 s · 2 successes');
      expect(toggle(t('up.hc.unhealthy'))).toHaveAccessibleDescription('every 1 s · 3 HTTP failures · 3 timeouts');
      expect(toggle(t('up.hc.passiveHealthy'))).toHaveAccessibleDescription('4 successes');
      expect(toggle(t('up.hc.passiveUnhealthy'))).toHaveAccessibleDescription('statuses 500, 503');
      expect(screen.queryByRole('spinbutton', { name: t('up.hc.successes') })).not.toBeInTheDocument();
    });

    it('a section that sets nothing says "defaults"; the locked view shows the same sections and summaries', async () => {
      const h = renderUpstream({ checks: { active: { http_path: '/h' } } }, { section: 'health', locked: true });
      expect(toggle(t('up.hc.healthy'))).toHaveAccessibleDescription(t('up.hc.sum.defaults'));
      expect(toggle(t('up.hc.unhealthy'))).toHaveAccessibleDescription(t('up.hc.sum.defaults'));
      await h.user.click(toggle(t('up.hc.probe')));
      expect(toggle(t('up.hc.probe'))).toHaveAccessibleDescription('/h');
    });

    it('a problem inside a closed section opens it and counts beside its title', () => {
      const h = renderUpstream({ checks: { active: {} } }, { section: 'health' });
      expect(toggle(t('up.hc.unhealthy'))).toHaveAttribute('aria-expanded', 'false');
      h.update({ issues: [{ path: 'checks.active.unhealthy.timeouts', message: 'too many' }] });
      expect(toggle(t('up.hc.unhealthy'))).toHaveAttribute('aria-expanded', 'true');
      expect(within(toggle(t('up.hc.unhealthy'))).getByText(t('ui.tabs.errors', { count: 1 }))).toBeInTheDocument();
      expect(toggle(t('up.hc.healthy'))).toHaveAttribute('aria-expanded', 'false');
    });

    it('a section whose field holds unfinished input does not close', async () => {
      const h = renderUpstream({ checks: { active: {} } }, { section: 'health' });
      await h.user.click(toggle(t('up.hc.healthy')));
      await h.user.type(screen.getByRole('spinbutton', { name: t('up.hc.interval') }), '1x');
      await h.user.click(toggle(t('up.hc.healthy')));
      expect(toggle(t('up.hc.healthy'))).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('spinbutton', { name: t('up.hc.interval') })).toHaveValue('1x');
    });
  });
});

describe('connection', () => {
  it('changing one timeout writes all three; clearing all three removes timeout', async () => {
    const h = renderUpstream({ x_future: 1 }, { section: 'connection' });
    const connect = screen.getByRole('spinbutton', { name: t('up.conn.connect') });
    await h.user.type(connect, '5');
    expect(h.value()).toEqual({ x_future: 1, timeout: { connect: 5, send: 60, read: 60 } });

    await h.user.clear(connect);
    await h.user.clear(screen.getByRole('spinbutton', { name: t('up.conn.send') }));
    expect(h.value().timeout).toEqual({ read: 60 });
    await h.user.clear(screen.getByRole('spinbutton', { name: t('up.conn.read') }));
    expect(h.value()).toEqual({ x_future: 1 });
  });

  it('shows upstream_host only for pass_host rewrite, and removes it when switching away', async () => {
    const h = renderUpstream({ pass_host: 'rewrite', upstream_host: 'api.example.com' }, { section: 'connection' });
    expect(screen.getByRole('textbox', { name: req(t('up.conn.upstreamHost')) })).toHaveValue('api.example.com');
    await choose(h.user, t('up.conn.passHost'), /^node/);
    expect(h.value()).toEqual({ pass_host: 'node' });
    expect(screen.queryByRole('textbox', { name: req(t('up.conn.upstreamHost')) })).not.toBeInTheDocument();
  });

  it('writes the keepalive pool and retries', async () => {
    const h = renderUpstream({}, { section: 'connection' });
    await h.user.type(screen.getByRole('spinbutton', { name: t('up.conn.poolSize') }), '64');
    await h.user.type(screen.getByRole('spinbutton', { name: t('up.conn.retries') }), '2');
    await choose(h.user, t('up.conn.scheme'), 'https');
    expect(h.value()).toEqual({ keepalive_pool: { size: 64 }, retries: 2, scheme: 'https' });
  });
});

describe('TLS', () => {
  const ctx = ctxOf({
    ssls: [
      itemOf('c1', { type: 'client', cert: 'x', name: 'mtls-client' }),
      itemOf('s1', { type: 'server', cert: 'x', snis: ['a.example'] }),
      itemOf('s2', { cert: 'x', sni: 'b.example' }),
    ],
  });

  it('choosing an SSL object writes client_cert_id and removes the inline pair; only client certificates are offered', async () => {
    const h = renderUpstream({ tls: { client_cert: 'CERT', client_key: 'KEY', verify: true } }, { section: 'tls', ctx });
    expect(screen.getByRole('radio', { name: t('up.tls.mode.inline') })).toBeChecked();
    await h.user.click(screen.getByRole('radio', { name: t('up.tls.mode.ssl') }));
    expect(h.value()).toEqual({ tls: { verify: true } });

    await h.user.click(screen.getByRole('combobox', { name: t('up.tls.ssl') }));
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['mtls-clientc1']);
    await h.user.click(options[0] as HTMLElement);
    expect(h.value()).toEqual({ tls: { verify: true, client_cert_id: 'c1' } });
  });

  it('writes an inline pair and masks a stored key', async () => {
    const h = renderUpstream({ tls: { client_cert: 'CERT', client_key: 'ENCRYPTED' } }, { section: 'tls' });
    expect(screen.queryByText('ENCRYPTED')).not.toBeInTheDocument();
    expect(screen.getByText(t('up.tls.keyStored'))).toBeInTheDocument();
    await h.user.click(screen.getByRole('button', { name: t('up.tls.replaceKey') }));
    await h.user.type(screen.getByRole('textbox', { name: t('up.tls.key') }), 'NEW');
    expect(h.value()).toEqual({ tls: { client_cert: 'CERT', client_key: 'NEW' } });
  });

  it('sets verify, and None removes the client certificate', async () => {
    const h = renderUpstream({ tls: { client_cert_id: 'c1' } }, { section: 'tls', ctx });
    await choose(h.user, t('up.tls.verify'), t('up.tls.verifyOn'));
    expect(h.value()).toEqual({ tls: { client_cert_id: 'c1', verify: true } });
    await h.user.click(screen.getByRole('radio', { name: t('up.tls.mode.none') }));
    expect(h.value()).toEqual({ tls: { verify: true } });
    await choose(h.user, t('up.tls.verify'), t('up.tls.verifyDefault'));
    await waitFor(() => expect(h.value()).toEqual({}));
  });

  it('the SSL object picker says loading, not "not found", until the SSL list has loaded', () => {
    renderUpstream({ tls: { client_cert_id: 'c1' } }, { section: 'tls', ctx: ctxOf({ loaded: { ssls: false } }) });
    const picker = screen.getByRole('combobox', { name: t('up.tls.ssl') });
    expect(picker).toHaveTextContent('c1');
    expect(picker).toHaveAccessibleDescription(t('picker.loading'));
  });
});
