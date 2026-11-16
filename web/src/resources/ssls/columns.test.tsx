import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Item, Obj } from '../../api/types';
import { t } from '../../i18n';
import { applyFilters, type FilterSelection } from '../../table/filter';
import { sortItems } from '../../table/sort';
import { EC_IPV6, FAR, RSA_LEAF } from '../../test/certs';
import { ctxOf, itemOf } from '../../test/ctx';
import { renderWithProviders } from '../../test/providers';
import { SEED_CERT } from '../../test/sslSeed';
import { registry, type ColumnDef, type Ctx } from '../registry';
import { sslColumns } from './columns';
import { sslFilters } from './filters';
import { parseCert } from './parseCert';

afterEach(() => vi.useRealTimers());

function col(id: string): ColumnDef {
  const column = sslColumns.find((c) => c.id === id);
  if (!column) throw new Error(`no column ${id}`);
  return column;
}

const ssl = (id: string, value: Obj): Item => itemOf(id, value);
const value = (id: string, item: Item, ctx: Ctx = ctxOf()) => col(id).accessor(item, ctx);

function cell(id: string, item: Item, ctx: Ctx = ctxOf()) {
  const user = userEvent.setup();
  const view = renderWithProviders(<div data-testid="cell">{col(id).cell?.(item, ctx)}</div>, { counts: {} });
  return { user, el: within(view.container).getByTestId('cell') };
}

const SEED = ssl('apiseven-test', { type: 'server', snis: ['apiseven.test', '*.apiseven.test'], cert: SEED_CERT, labels: { env: 'dev' }, update_time: 10 });
const EXACT = ssl('exact', { snis: ['a.apiseven.test'], cert: RSA_LEAF });
const CLIENT = ssl('mtls-client', { type: 'client', cert: EC_IPV6 });

const ROUTES = [
  itemOf('r1', { hosts: ['a.apiseven.test', 'b.apiseven.test'] }),
  itemOf('r2', { host: 'b.apiseven.test' }),
  itemOf('r3', { service_id: 's1' }),
  itemOf('r4', { host: '*.apiseven.test' }),
  itemOf('r5', { host: 'other.test' }),
  itemOf('r6', { uri: '/any' }),
];
const CTX = ctxOf({
  ssls: [SEED, EXACT, CLIENT],
  routes: ROUTES,
  services: [itemOf('s1', { hosts: ['www.apiseven.test'] })],
  upstreams: [itemOf('u1', { name: 'secure-pool', tls: { client_cert_id: 'mtls-client' } })],
});

describe('SSL columns', () => {
  it('lists the columns in order, the main ones visible by default (status comes from the table)', () => {
    expect(sslColumns.map((c) => c.id)).toEqual(['snis', 'expires', 'issuer', 'type', 'used_by', 'updated', 'id', 'subject', 'not_before', 'serial', 'labels', 'mtls', 'created']);
    expect(sslColumns.filter((c) => c.defaultVisible).map((c) => c.id)).toEqual(['snis', 'expires', 'issuer', 'type', 'used_by', 'updated']);
    // The default columns fit the 810px a 1280px window leaves beside the sidebar, status, checkbox and actions.
    expect(sslColumns.filter((c) => c.defaultVisible).reduce((sum, c) => sum + (c.width ?? 0), 0)).toBeLessThanOrEqual(810);
  });

  it('snis: the first SNI links to the editor, the others stacked under it in mono; a certificate without SNIs links by id', () => {
    const { el } = cell('snis', SEED, CTX);
    const link = within(el).getByRole('link', { name: 'apiseven.test' });
    expect(link).toHaveAttribute('href', '/ssls/apiseven-test');
    expect(link).toHaveClass('mono');
    expect(el).toHaveTextContent('*.apiseven.test');
    expect(value('snis', SEED)).toEqual(['apiseven.test', '*.apiseven.test']);
    const client = cell('snis', CLIENT);
    expect(within(client.el).getAllByRole('link').at(-1)).toHaveTextContent('mtls-client');
  });

  it('the name of an SSL is its first SNI, else its id (delete dialogs, search)', () => {
    expect(registry.ssls.nameOf(SEED)).toBe('apiseven.test');
    expect(registry.ssls.nameOf(ssl('one', { sni: 'one.test' }))).toBe('one.test');
    expect(registry.ssls.nameOf(CLIENT)).toBe('mtls-client');
  });

  it('expires: the certificate expiry in ms, sorted as a number, unreadable ones last; the cell is the expiry badge', () => {
    const far = ssl('far', { snis: ['f.test'], cert: FAR });
    const soon = ssl('soon', { snis: ['s.test'], cert: EC_IPV6 });
    const ref = ssl('ref', { snis: ['r.test'], cert: '$secret://vault/1/cert' });
    expect(value('expires', far)).toBe(parseCert(FAR)?.notAfter);
    const sorted = sortItems([ref, far, SEED, soon], [{ id: 'expires', desc: false }], sslColumns, ctxOf());
    expect(sorted.map((i) => i.id)).toEqual(['soon', 'apiseven-test', 'far', 'ref']);
    vi.useFakeTimers({ now: Date.UTC(2027, 10, 10), toFake: ['Date'] });
    expect(cell('expires', soon).el.querySelector('.ui-badge')).toHaveClass('expiry--warn');
    expect(cell('expires', ref).el).toHaveTextContent(t('ui.empty'));
  });

  it("issuer: the issuer's CN, else its O, the whole name in the title; subject and serial alike", () => {
    expect(value('issuer', EXACT)).toBe('apiseven Test Root');
    expect(cell('issuer', EXACT).el.querySelector('[title]')).toHaveAttribute('title', 'C=TW, O=apiseven test CA, CN=apiseven Test Root');
    expect(value('issuer', ssl('o', { cert: 'not a PEM' }))).toBeUndefined();
    expect(value('subject', SEED)).toBe('CN=apiseven.test');
    expect(value('serial', SEED)).toBe('493512B66094780277105F6C6F37DA5ED26CC0DE');
    expect(value('not_before', SEED)).toBe(parseCert(SEED_CERT)?.notBefore);
  });

  it('type: server unless stored as client; mtls: whether client verification is set', () => {
    expect(value('type', EXACT)).toBe(t('ssl.type.server'));
    expect(value('type', CLIENT)).toBe(t('ssl.type.client'));
    expect(value('mtls', SEED)).toBe(t('ui.no'));
    expect(value('mtls', ssl('m', { client: { ca: SEED_CERT } }))).toBe(t('ui.yes'));
  });

  it('used_by: the route hosts, own or a service’s, for which APISIX serves this certificate, each once', async () => {
    // a.apiseven.test goes to the exact SNI; b (twice), www (from the service) and the wildcard host to the seed.
    expect(value('used_by', SEED, CTX)).toBe(3);
    expect(value('used_by', EXACT, CTX)).toBe(1);
    const { user, el } = cell('used_by', SEED, CTX);
    const count = within(el).getByRole('button', { name: t('ssl.usedBy.hosts', { count: 3 }) });
    await user.hover(count);
    const tip = await screen.findByRole('tooltip');
    expect(within(tip).getAllByText(/apiseven\.test/).map((n) => n.textContent)).toEqual(['*.apiseven.test', 'b.apiseven.test', 'www.apiseven.test']);
  });

  it('used_by: a host shared with another certificate of the same SNI counts for both, marked as shared', async () => {
    const twin = ssl('twin', { snis: ['a.apiseven.test'], cert: RSA_LEAF });
    const ctx = { ...CTX, ssls: [SEED, EXACT, twin] };
    expect(value('used_by', EXACT, ctx)).toBe(1);
    expect(value('used_by', twin, ctx)).toBe(1);
    const { user, el } = cell('used_by', twin, ctx);
    // One host, one other certificate: singular forms (Task 16b, item 98).
    const count = within(el).getByRole('button', { name: t('ssl.usedBy.hostsOne') });
    expect(count).toHaveAccessibleName('Presented for 1 route host');
    await user.hover(count);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(`a.apiseven.test ${t('ssl.usedBy.sharedOne')}`);
    expect(t('ssl.usedBy.sharedOne')).toMatch(/^\(shared with 1 other certificate: /);
  });

  it('used_by: no route host reads so, not "unused" (a TLS client gets the certificate for its SNIs all the same)', () => {
    const lone = ssl('lone', { snis: ['lone.test'] });
    expect(value('used_by', lone, CTX)).toBe(0);
    expect(cell('used_by', lone, CTX).el).toHaveTextContent(t('ssl.usedBy.noHost'));
  });

  it('used_by: while routes or services load, nothing definite', () => {
    const loading = ctxOf({ ...CTX, loaded: { services: false } });
    expect(value('used_by', SEED, loading)).toBeUndefined();
    expect(cell('used_by', SEED, loading).el).toHaveTextContent(t('picker.loading'));
  });

  it('used_by: a client certificate is used by the upstreams that name it (never by a route host)', () => {
    expect(value('used_by', CLIENT, CTX)).toBe(1);
    expect(within(cell('used_by', CLIENT, CTX).el).getByRole('button', { name: t('cell.usedBy', { count: 1 }) })).toBeInTheDocument();
    expect(value('used_by', CLIENT, ctxOf({ ...CTX, loaded: { upstreams: false } }))).toBeUndefined();
  });

  // Fix round 2, item 7: the column waits on the one table of lists (referenceUse), and a list that failed
  // to load leaves it "unknown", never "loading…" for ever.
  it('used_by: a list it depends on failed to load: "unknown", no sort value, for a client and a server certificate', () => {
    for (const [list, item] of [['streamRoutes', CLIENT], ['upstreams', CLIENT], ['services', SEED]] as const) {
      const failed = ctxOf({ ...CTX, loaded: { [list]: false }, failed: { [list]: true } });
      expect(value('used_by', item, failed), list).toBeUndefined();
      expect(cell('used_by', item, failed).el, list).toHaveTextContent(t('cell.usedBy.unknown'));
      cleanup();
    }
  });
});

describe('SSL filters', () => {
  const filter = (id: string) => {
    const def = sslFilters.find((f) => f.id === id);
    if (!def) throw new Error(`no filter ${id}`);
    return def;
  };
  const ITEMS = [SEED, EXACT, CLIENT, ssl('off', { snis: ['off.test'], status: 0, cert: FAR }), ssl('ref', { snis: ['r.test'], cert: '$env://CERT' })];
  const ids = (selection: FilterSelection, ctx: Ctx = { ...CTX, ssls: ITEMS }) => applyFilters(ITEMS, '', sslFilters, selection, ctx).map((i) => i.id);

  it('offers status, type, expiry and usage', () => {
    expect(sslFilters.map((f) => f.id)).toEqual(['status', 'type', 'expiry', 'unused']);
  });

  it('status: a client certificate is in neither (APISIX ignores its status)', () => {
    expect(ids({ status: ['enabled'] })).toEqual(['apiseven-test', 'exact', 'ref']);
    expect(ids({ status: ['disabled'] })).toEqual(['off']);
  });

  it('type: server (also when unset) or client', () => {
    expect(ids({ type: ['client'] })).toEqual(['mtls-client']);
    expect(ids({ type: ['server'] })).toEqual(['apiseven-test', 'exact', 'off', 'ref']);
  });

  it('expiry: expired, within 14 days, later, and unknown (unreadable or a reference)', () => {
    vi.useFakeTimers({ now: Date.UTC(2027, 10, 10), toFake: ['Date'] });
    expect(filter('expiry').options(ITEMS, CTX).map((o) => o.value)).toEqual(['expired', 'soon', 'ok', 'unknown']);
    // EC_IPV6 ends 2027-11-14, RSA_LEAF 2029-02-16, the seed 2036, FAR 2051.
    expect(ids({ expiry: ['soon'] })).toEqual(['mtls-client']);
    expect(ids({ expiry: ['ok'] })).toEqual(['apiseven-test', 'exact', 'off']);
    expect(ids({ expiry: ['unknown'] })).toEqual(['ref']);
    vi.useFakeTimers({ now: Date.UTC(2030, 0, 1), toFake: ['Date'] });
    expect(ids({ expiry: ['expired'] })).toEqual(['exact', 'mtls-client']);
  });

  it('unused: no route host and no upstream that names it; nothing while the lists load', () => {
    expect(filter('unused').options(ITEMS, CTX).map((o) => o.label)).toEqual([t('ssl.filter.none'), t('ssl.filter.some')]);
    expect(ids({ unused: ['unused'] })).toEqual(['off', 'ref']);
    expect(ids({ unused: ['used'] })).toEqual(['apiseven-test', 'exact', 'mtls-client']);
    expect(ids({ unused: ['unused', 'used'] }, ctxOf({ ...CTX, ssls: ITEMS, loaded: { routes: false } }))).toEqual([]);
  });
});
