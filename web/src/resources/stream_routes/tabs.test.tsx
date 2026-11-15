// The stream route editor's tabs, each rendered as the frame renders it (controlled by the draft).
import { screen, waitFor, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Obj } from '../../api/types';
import { t } from '../../i18n';
import { ctxOf, itemOf } from '../../test/ctx';
import { editableControls } from '../../test/schemaForm';
import { renderTab, type TabOptions } from '../../test/tab';
import type { TabProps } from '../registry';
import { AdvancedTab, GeneralTab, MatchingTab, UpstreamTab } from './bodies';
import { streamRouteIssues } from './validate';

beforeAll(async () => {
  await import('../../upstream/UpstreamForm');
  await import('../../schema-form/SchemaForm');
});

const CTX = ctxOf({
  upstreams: [itemOf('web-pool', { name: 'web-pool', nodes: [{ host: '10.0.0.11', port: 8080, weight: 1 }] })],
  services: [itemOf('web', { name: 'web', upstream_id: 'web-pool', plugins: { 'ip-restriction': { whitelist: ['10.0.0.0/8'] } } })],
  streamRoutes: [itemOf('redis-main', { name: 'redis-main', protocol: { name: 'redis' } }), itemOf('sr1', { name: 'full' })],
});

/** Every field a stream route can have. */
const FULL: Obj = {
  id: 'sr1',
  name: 'full',
  desc: 'Every field set',
  labels: { env: 'dev' },
  server_addr: '127.0.0.1',
  server_port: 9100,
  remote_addr: '10.0.0.0/8',
  snis: ['a.example', '*.b.example'],
  tls_passthrough: true,
  service_id: 'web',
  upstream_id: 'web-pool',
  plugins: { 'limit-conn': { conn: 100, burst: 50, default_conn_delay: 0.1, key: 'remote_addr' } },
  protocol: { name: 'redis', superior_id: 'redis-main', conf: { faults: [] }, logger: [{ name: 'syslog', conf: {} }] },
};

const tab = (Tab: ComponentType<TabProps>, draft: Obj, opts: TabOptions = {}) =>
  renderTab('stream_routes', Tab, draft, streamRouteIssues, { ctx: CTX, ...opts });

describe('every tab of a full stream route, locked, reads as text', () => {
  it.each([
    ['General', GeneralTab],
    ['Matching', MatchingTab],
    ['Upstream', UpstreamTab],
    ['Advanced', AdvancedTab],
  ])('%s: no form controls', async (_, Tab) => {
    const { container } = tab(Tab, FULL, { locked: true });
    await waitFor(() => expect(container.querySelector('.ed-lazy__loading, [aria-busy="true"]')).toBeNull());
    expect(editableControls(container)).toEqual([]);
  });
});

describe('Matching', () => {
  const box = (key: string) => screen.getByRole('textbox', { name: t(`sr.match.${key}`) });

  it('says every field is optional and all that are set must match', () => {
    tab(MatchingTab, {});
    expect(screen.getByText(t('sr.match.help'))).toBeInTheDocument();
  });

  it('server_port is written as a number; cleared, it is removed', async () => {
    const h = tab(MatchingTab, {});
    const port = screen.getByRole('spinbutton', { name: t('sr.match.serverPort') });
    await h.user.type(port, '9100');
    expect(h.value()).toEqual({ server_port: 9100 });
    expect(typeof h.value().server_port).toBe('number');
    await h.user.clear(port);
    expect(h.value()).toEqual({});
  });

  it('port text that is not a number is held, named Server port; the draft keeps the last number', async () => {
    const h = tab(MatchingTab, { server_port: 9100 });
    await h.user.type(screen.getByRole('spinbutton', { name: t('sr.match.serverPort') }), 'x');
    expect(h.held()).toEqual([t('ui.pending.notNumber', { field: t('sr.match.serverPort'), text: '9100x' })]);
    expect(h.value()).toEqual({ server_port: 9100 });
  });

  it('a port out of range is flagged at the field', async () => {
    const h = tab(MatchingTab, {});
    await h.user.type(screen.getByRole('spinbutton', { name: t('sr.match.serverPort') }), '70000');
    expect(h.value()).toEqual({ server_port: 70000 });
    expect(screen.getByRole('spinbutton', { name: t('sr.match.serverPort') })).toHaveAccessibleDescription(new RegExp(t('sr.issue.port').replace('.', '\\.')));
  });

  it('addresses are written as typed and flagged when APISIX would refuse them; emptied, they are removed', async () => {
    const h = tab(MatchingTab, {});
    await h.user.type(box('serverAddr'), '127.0.0.1');
    await h.user.type(box('remoteAddr'), 'fe80::/200');
    expect(h.value()).toEqual({ server_addr: '127.0.0.1', remote_addr: 'fe80::/200' });
    expect(box('remoteAddr')).toHaveAttribute('aria-invalid', 'true');
    expect(box('serverAddr')).not.toHaveAttribute('aria-invalid');
    await h.user.clear(box('remoteAddr'));
    await h.user.clear(box('serverAddr'));
    expect(h.value()).toEqual({});
  });

  it('SNIs: one is written as sni, several as snis; one APISIX refuses is held, named SNIs', async () => {
    const h = tab(MatchingTab, {});
    const snis = box('snis');
    await h.user.type(snis, 'a.example{Enter}');
    expect(h.value()).toEqual({ sni: 'a.example' });
    await h.user.type(snis, '*.b.example{Enter}');
    expect(h.value()).toEqual({ snis: ['a.example', '*.b.example'] });
    await h.user.type(snis, 'bad host{Enter}');
    expect(h.held()).toEqual([t('ui.pending.tag', { field: t('sr.match.snis'), text: 'bad host', reason: t('rt.issue.host', { host: 'bad host' }) })]);
    expect(h.value()).toEqual({ snis: ['a.example', '*.b.example'] });
    await h.user.clear(snis);
    await h.user.click(screen.getByRole('button', { name: t('ui.tags.remove', { tag: 'a.example' }) }));
    expect(h.value()).toEqual({ sni: '*.b.example' });
  });

  it('locked: mono values, and what an unset field means', () => {
    tab(MatchingTab, FULL, { locked: true });
    expect(screen.getByText('127.0.0.1')).toHaveClass('mono');
    expect(screen.getByText('*.b.example')).toHaveClass('mono');
    tab(MatchingTab, {}, { locked: true });
    for (const key of ['anyServerAddr', 'anyPort', 'anyClient', 'anySni']) expect(screen.getByText(t(`sr.match.${key}`))).toBeInTheDocument();
  });
});

describe('Upstream', () => {
  it('the service\'s upstream, an existing one, or inline; with a service, resolves through it', () => {
    tab(UpstreamTab, { service_id: 'web' });
    expect(within(screen.getByRole('radiogroup', { name: t('rt.up.source') })).getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByRole('radio', { name: t('rt.up.source.service') })).toBeChecked();
    expect(screen.getByRole('group', { name: t('rt.up.resolves') })).toHaveTextContent(`web-pool${t('rt.up.viaService', { name: 'web' })}`);
  });

  it('a new stream route starts on Inline', async () => {
    tab(UpstreamTab, {}, { isNew: true });
    expect(screen.getByRole('radio', { name: t('rt.up.source.inline') })).toBeChecked();
    expect(await screen.findByRole('textbox', { name: t('up.nodes.new') })).toBeInTheDocument();
  });
});

describe('Advanced', () => {
  it('TLS passthrough: on writes true; off removes it (false is the default)', async () => {
    const h = tab(AdvancedTab, {});
    const sw = screen.getByRole('switch', { name: t('sr.adv.passthrough') });
    await h.user.click(sw);
    expect(h.value()).toEqual({ tls_passthrough: true });
    await h.user.click(sw);
    expect(h.value()).toEqual({});
  });

  it('protocol: a name, a superior (never itself), conf and logger as JSON', async () => {
    const h = tab(AdvancedTab, { id: 'sr1' });
    await h.user.click(screen.getByRole('button', { name: new RegExp(`^${t('sr.adv.protocol').replace(/[()]/g, '\\$&')}`) }));
    await h.user.type(screen.getByRole('textbox', { name: t('sr.adv.protocolName') }), 'redis');
    expect(h.value()).toEqual({ id: 'sr1', protocol: { name: 'redis' } });

    await h.user.click(screen.getByRole('combobox', { name: t('sr.adv.superior') }));
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([expect.stringContaining('redis-main')]);
    await h.user.click(options[0] as HTMLElement);
    expect(h.value()).toEqual({ id: 'sr1', protocol: { name: 'redis', superior_id: 'redis-main' } });

    const conf = screen.getByRole('textbox', { name: t('sf.json.label', { key: 'conf' }) });
    await h.user.click(conf);
    await h.user.paste('{"faults": [');
    expect(h.held()).toEqual([t('ui.pending.json', { field: 'protocol.conf' })]);
    expect(h.value()).toEqual({ id: 'sr1', protocol: { name: 'redis', superior_id: 'redis-main' } });
    await h.user.paste(']}');
    expect(h.held()).toEqual([]);
    expect(h.value()).toEqual({ id: 'sr1', protocol: { name: 'redis', superior_id: 'redis-main', conf: { faults: [] } } });
  });

  it('clearing the protocol name of a protocol with nothing else removes protocol', async () => {
    const h = tab(AdvancedTab, { protocol: { name: 'redis' } });
    await h.user.clear(screen.getByRole('textbox', { name: t('sr.adv.protocolName') }));
    expect(h.value()).toEqual({});
  });

  it('a logger entry the schema refuses is flagged on the logger field', () => {
    tab(AdvancedTab, { protocol: { name: 'redis', logger: [{ name: 'syslog' }] } });
    expect(screen.getByText(t('sr.issue.loggerEntry', { n: 1 }))).toBeInTheDocument();
  });

  it('locked without a protocol: plain proxying, and passthrough off', () => {
    tab(AdvancedTab, {}, { locked: true });
    expect(screen.getByText(t('sr.adv.noProtocol'))).toBeInTheDocument();
    expect(screen.getByText(t('ui.off'))).toBeInTheDocument();
  });
});

describe('General', () => {
  it('edits name, description and labels', async () => {
    const h = tab(GeneralTab, {});
    await h.user.type(screen.getByRole('textbox', { name: t('sr.general.name') }), 'etcd-tcp');
    await h.user.type(screen.getByRole('textbox', { name: t('sr.general.desc') }), 'To etcd');
    expect(h.value()).toEqual({ name: 'etcd-tcp', desc: 'To etcd' });
  });

  it('the overview: what it matches, where it goes, its plugins (and the service\'s), the rest', () => {
    tab(GeneralTab, FULL, { locked: true });
    const overview = screen.getByRole('region', { name: t('sr.overview') });
    expect(overview).toHaveTextContent('127.0.0.1:9100');
    expect(overview).toHaveTextContent('10.0.0.0/8');
    expect(overview).toHaveTextContent('a.example, *.b.example');
    expect(overview).toHaveTextContent('web-pool');
    expect(overview).toHaveTextContent('limit-conn');
    expect(overview).toHaveTextContent('ip-restriction');
    expect(overview).toHaveTextContent('redis');
    expect(within(overview).getByRole('link', { name: t('sr.tab.matching') })).toHaveAttribute('href', '/?tab=matching');
  });

  it('the overview lists only the service plugins that can run on a stream route, as the list does (plugin.stream_filter; Ruling 3)', () => {
    const ctx = ctxOf({ ...CTX, services: [itemOf('web', { name: 'web', plugins: { 'limit-count': {}, 'limit-conn': {} } })] });
    tab(GeneralTab, { service_id: 'web', plugins: { 'ip-restriction': {} } }, { locked: true, ctx });
    const overview = screen.getByRole('region', { name: t('sr.overview') });
    expect(overview).toHaveTextContent(`ip-restrictionlimit-conn ${t('rt.overview.viaService')}`);
    expect(overview).not.toHaveTextContent('limit-count');
  });

  it('the overview of a bare stream route, and while the service is loading', () => {
    tab(GeneralTab, {}, { locked: true });
    const bare = screen.getByRole('region', { name: t('sr.overview') });
    expect(bare).toHaveTextContent(t('sr.overview.anyConnection'));
    expect(bare).toHaveTextContent(t('rt.up.resolvesNone'));
    tab(GeneralTab, { service_id: 'web' }, { locked: true, ctx: ctxOf({ loaded: { services: false } }) });
    const loading = screen.getAllByRole('region', { name: t('sr.overview') })[1] as HTMLElement;
    expect(loading.textContent?.split(t('picker.loading')).length).toBeGreaterThanOrEqual(3);
  });
});
