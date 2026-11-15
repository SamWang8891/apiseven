import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Item, Obj } from '../../api/types';
import { t } from '../../i18n';
import { formatAbsolute } from '../../table/format';
import { sortItems } from '../../table/sort';
import { RSA_LEAF } from '../../test/certs';
import { ctxOf, itemOf } from '../../test/ctx';
import { renderWithProviders } from '../../test/providers';
import type { ColumnDef, Ctx } from '../registry';
import { parseCert } from '../ssls/parseCert';
import { routeColumns } from './columns';

afterEach(() => vi.useRealTimers());

/** Makes jsdom report `el` narrower than its text, as a browser does for an ellipsis. */
function clip(el: HTMLElement) {
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: 240 });
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: 100 });
}
function unclip(el: HTMLElement) {
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: 100 });
}

function col(id: string): ColumnDef {
  const column = routeColumns.find((c) => c.id === id);
  if (!column) throw new Error(`no column ${id}`);
  return column;
}

const route = (value: Obj, id = 'r1'): Item => itemOf(id, value);
const value = (id: string, item: Item, ctx: Ctx = ctxOf()) => col(id).accessor(item, ctx);

/** Renders one column's cell for `item`, the way the table hosts it. */
function cell(id: string, item: Item, ctx: Ctx = ctxOf()) {
  const user = userEvent.setup();
  const view = renderWithProviders(<div data-testid="cell">{col(id).cell?.(item, ctx)}</div>, { counts: {} });
  return { user, el: screen.getByTestId('cell'), ...view };
}

const SERVICES = [
  itemOf('s1', { name: 'web', hosts: ['a.example', 'www.a.example'], upstream_id: 'u1', plugins: { gzip: {}, cors: {} } }),
  itemOf('s2', { hosts: ['b.example'] }),
];
const CTX = ctxOf({
  services: SERVICES,
  upstreams: [itemOf('u1', { name: 'pool', nodes: [{ host: '10.0.0.1', port: 80, weight: 1 }, { host: '10.0.0.2', port: 80, weight: 1 }] })],
  pluginConfigs: [itemOf('pc1', { name: 'common', plugins: { 'response-rewrite': {} } })],
});

// Task 16b item 38: a stored field of another shape than the schema's is shown or left out, never a crash.
describe('route columns on odd shapes', () => {
  const ODD: Obj[] = [
    { desc: 5 },
    { desc: { a: 1 } },
    { labels: 'x' },
    { labels: ['a'] },
    { plugins: null },
    { plugins: 'x' },
    { plugins: { a: null } },
    { methods: 'GET' },
    { methods: [1, null] },
    { name: 7, uris: 'x', uri: 3, hosts: 'a', host: 4, remote_addrs: 'x', vars: 'x', timeout: 'x', priority: 'x', create_time: 'x', update_time: null },
    { service_id: { a: 1 }, plugin_config_id: [], upstream_id: 5, upstream: 'x', enable_websocket: 'yes' },
  ];

  it('every column reads, renders and sorts such rows without throwing', () => {
    const items = ODD.map((v, i) => route(v, `odd${i}`));
    for (const item of items) {
      for (const column of routeColumns) {
        expect(() => column.accessor(item, CTX), `${column.id} ${JSON.stringify(item.value)}`).not.toThrow();
        const { unmount } = renderWithProviders(<div>{column.cell?.(item, CTX)}</div>, { counts: {} });
        unmount();
      }
    }
    for (const column of routeColumns) expect(() => sortItems(items, [{ id: column.id, desc: false }], routeColumns, CTX), column.id).not.toThrow();
  });
});

describe('route columns', () => {
  it('lists the columns in order, the main ones visible by default (status comes from the table)', () => {
    expect(routeColumns.map((c) => c.id)).toEqual([
      'name', 'hosts', 'uris', 'methods', 'upstream', 'plugins', 'updated',
      'id', 'desc', 'priority', 'service', 'plugin_config', 'labels', 'remote_addrs', 'vars', 'created',
      'ssl_expiry', 'timeout', 'websocket',
    ]);
    expect(routeColumns.filter((c) => c.defaultVisible).map((c) => c.id)).toEqual([
      'name', 'hosts', 'uris', 'methods', 'upstream', 'plugins', 'updated',
    ]);
    for (const column of routeColumns) {
      expect(column.header, column.id).not.toMatch(/^column\./);
      expect(column.width, column.id).toBeGreaterThan(0);
    }
  });

  it('reads the headers from the language table at use', () => {
    expect(col('hosts').header).toBe(t('column.hosts'));
    expect(col('ssl_expiry').header).toBe(t('column.ssl_expiry'));
  });
});

describe('name', () => {
  it('links to the editor, with the description as a second line', () => {
    const { el } = cell('name', route({ name: 'shop', desc: 'Storefront' }));
    expect(within(el).getByRole('link', { name: 'shop' })).toHaveAttribute('href', '/routes/r1');
    expect(within(el).getByText('Storefront')).toHaveClass('cell-sub');
  });

  it('does not repeat the description when it stands in for the name', () => {
    const { el } = cell('name', route({ desc: 'Storefront' }));
    expect(within(el).getByRole('link', { name: 'Storefront' })).toBeInTheDocument();
    expect(within(el).getAllByText('Storefront')).toHaveLength(1);
  });
});

describe('hosts', () => {
  it('reads `host` or `hosts`, else the service hosts', () => {
    expect(value('hosts', route({ host: 'api.example' }))).toEqual(['api.example']);
    expect(value('hosts', route({ hosts: ['a.example', '*.b.example'] }))).toEqual(['a.example', '*.b.example']);
    expect(value('hosts', route({ service_id: 's1' }), CTX)).toEqual(['a.example', 'www.a.example']);
    expect(value('hosts', route({ host: 'own.example', service_id: 's1' }), CTX)).toEqual(['own.example']);
    expect(value('hosts', route({}))).toEqual([]);
  });

  it('shows hosts one per line in monospace, marking inherited ones "via service"', () => {
    const own = cell('hosts', route({ hosts: ['a.example', 'b.example'] }));
    expect(within(own.el).getByText('a.example')).toHaveClass('mono');
    expect(within(own.el).getByText('b.example')).toHaveClass('mono');
    expect(within(own.el).queryByText(t('cell.viaService'))).not.toBeInTheDocument();
    own.unmount();

    const inherited = cell('hosts', route({ service_id: 's1' }), CTX);
    expect(within(inherited.el).getByText('www.a.example')).toHaveClass('mono');
    expect(within(inherited.el).getByText(t('cell.viaService'))).toHaveClass('ui-badge--accent');
  });

  it('says "any host" when the route matches every host', () => {
    const { el } = cell('hosts', route({ uri: '/*' }));
    expect(el).toHaveTextContent(t('cell.anyHost'));
  });
});

describe('uris and methods', () => {
  it('reads `uri` or `uris`', () => {
    expect(value('uris', route({ uri: '/v1/*' }))).toEqual(['/v1/*']);
    expect(value('uris', route({ uris: ['/a', '/b/*'] }))).toEqual(['/a', '/b/*']);
    expect(value('uris', route({}))).toEqual([]);
  });

  it('shows URIs one per line in monospace', () => {
    const { el } = cell('uris', route({ uris: ['/a', '/b/*'] }));
    expect(within(el).getByText('/b/*')).toHaveClass('mono');
  });

  it('is ANY when no methods are set', () => {
    expect(value('methods', route({}))).toEqual(['ANY']);
    expect(value('methods', route({ methods: [] }))).toEqual(['ANY']);
    expect(value('methods', route({ methods: ['GET', 'POST'] }))).toEqual(['GET', 'POST']);
  });

  it('shows each method as a chip', () => {
    const { el } = cell('methods', route({ methods: ['GET', 'DELETE'] }));
    expect(within(el).getByText('GET')).toHaveClass('cell-method');
    expect(within(el).getByText('DELETE')).toHaveClass('cell-method');
  });
});

describe('upstream', () => {
  it('is the label of where the route proxies to', () => {
    expect(value('upstream', route({ upstream_id: 'u1' }), CTX)).toBe('pool');
    expect(value('upstream', route({ upstream: { nodes: { '10.1.0.1:80': 1 } } }))).toBe('10.1.0.1:80');
    expect(value('upstream', route({ service_id: 's1' }), CTX)).toBe('web');
    expect(value('upstream', route({}))).toBeUndefined();
  });

  it('links to the upstream it names, with the nodes in a tooltip', async () => {
    const { el, user } = cell('upstream', route({ upstream_id: 'u1' }), CTX);
    const link = within(el).getByRole('link', { name: 'pool' });
    expect(link).toHaveAttribute('href', '/upstreams/u1');
    await user.hover(link);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('10.0.0.1:8010.0.0.2:80');
  });

  it("links a service's upstream to the service, marked via service", () => {
    const { el } = cell('upstream', route({ service_id: 's1' }), CTX);
    expect(within(el).getByRole('link', { name: 'web' })).toHaveAttribute('href', '/services/s1');
    expect(within(el).getByText(t('cell.viaService'))).toBeInTheDocument();
  });

  it('shows inline nodes one per line', () => {
    const { el } = cell('upstream', route({ upstream: { nodes: [{ host: '10.2.0.1', port: 8080, weight: 1 }, { host: '10.2.0.2', port: 8080, weight: 1 }] } }));
    expect(within(el).getByText('10.2.0.1:8080')).toHaveClass('mono');
    expect(within(el).getByText('10.2.0.2:8080')).toHaveClass('mono');
    expect(within(el).queryByRole('link')).not.toBeInTheDocument();
  });

  it('flags an upstream id that points nowhere with a danger badge', () => {
    expect(value('upstream', route({ upstream_id: 'gone' }))).toBe(t('cell.missing.upstreams', { id: 'gone' }));
    const { el } = cell('upstream', route({ upstream_id: 'gone' }));
    expect(within(el).getByText(t('cell.missing.upstreams', { id: 'gone' }))).toHaveClass('ui-badge--danger');
  });

  it('is the empty mark with no upstream at all', () => {
    const { el } = cell('upstream', route({}));
    expect(el).toHaveTextContent(t('ui.empty'));
  });
});

describe('plugins', () => {
  it('names every plugin that runs, the service and plugin config ones included', () => {
    expect(value('plugins', route({ plugins: { 'key-auth': {} }, service_id: 's1', plugin_config_id: 'pc1' }), CTX)).toEqual([
      'cors', 'gzip', 'key-auth', 'response-rewrite',
    ]);
  });

  it('marks plugins from the service and the plugin config, and says where from', async () => {
    const { el, user } = cell('plugins', route({ plugins: { 'key-auth': {} }, service_id: 's1', plugin_config_id: 'pc1' }), CTX);
    const own = within(el).getByText('key-auth').closest('.cell-plugin');
    const fromService = within(el).getByText('gzip').closest('.cell-plugin');
    const fromConfig = within(el).getByText('response-rewrite').closest('.cell-plugin');
    expect(own).not.toHaveClass('cell-plugin--inherited');
    expect(fromService).toHaveClass('cell-plugin--inherited');
    expect(fromService).toHaveTextContent(t('cell.plugin.fromService', { name: 'web' }));
    expect(fromConfig).toHaveClass('cell-plugin--inherited');
    expect(fromConfig).toHaveTextContent(t('cell.plugin.fromPluginConfig', { name: 'common' }));
    await user.hover(fromService as HTMLElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(t('cell.plugin.fromService', { name: 'web' }));
  });

  it('shows four chips, then +N with the whole list in a tooltip', async () => {
    const plugins = Object.fromEntries(['a-1', 'a-2', 'a-3', 'a-4', 'a-5', 'a-6'].map((name) => [name, {}]));
    const { el, user } = cell('plugins', route({ plugins }));
    expect(el.querySelectorAll('.cell-plugin')).toHaveLength(4);
    expect(within(el).queryByText('a-5')).not.toBeInTheDocument();
    const more = within(el).getByRole('button', { name: t('cell.more', { count: 2 }) });
    await user.hover(more);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/a-1.*a-2.*a-3.*a-4.*a-5.*a-6/);
  });

  it('says off on a disabled plugin', () => {
    const { el } = cell('plugins', route({ plugins: { cors: { _meta: { disable: true } }, gzip: {} } }));
    expect(within(el).getByText('cors').closest('.cell-plugin')).toHaveTextContent(`cors${t('cell.plugin.off')}`);
    expect(within(el).getByText('gzip').closest('.cell-plugin')).toHaveTextContent(/^gzip$/);
  });

  it('names a long plugin in full: the chip text can ellipsise, the chip title holds the name only while it is cut off', async () => {
    const own = cell('plugins', route({ plugins: { 'ext-plugin-post-resp': {} } }));
    const text = within(own.el).getByText('ext-plugin-post-resp');
    expect(text).toHaveClass('cell-chip__text');
    const chip = text.closest('.cell-plugin') as HTMLElement;
    // Known item 5: a title that repeats what is shown would be read twice.
    await own.user.hover(chip);
    expect(chip).not.toHaveAttribute('title');
    await own.user.unhover(chip);
    clip(text);
    await own.user.hover(chip);
    expect(chip).toHaveAttribute('title', 'ext-plugin-post-resp');
    own.unmount();

    // An inherited chip has a tooltip instead of a title: the name, then where it comes from.
    const ctx = ctxOf({ services: [itemOf('s1', { name: 'web', plugins: { 'request-validation': {} } })] });
    const { el, user } = cell('plugins', route({ service_id: 's1' }), ctx);
    const inherited = within(el).getByText('request-validation').closest('.cell-plugin') as HTMLElement;
    expect(inherited).not.toHaveAttribute('title');
    await user.hover(inherited);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(`request-validation${t('cell.plugin.fromService', { name: 'web' })}`);
  });

  it('an inherited chip takes keyboard focus and shows where it comes from (known item 3)', async () => {
    const ctx = ctxOf({ services: [itemOf('s1', { name: 'web', plugins: { 'request-validation': {} } })] });
    const { el, user } = cell('plugins', route({ service_id: 's1', plugins: { gzip: {} } }), ctx);
    const inherited = within(el).getByText('request-validation').closest('.cell-plugin') as HTMLElement;
    const own = within(el).getByText('gzip').closest('.cell-plugin') as HTMLElement;
    expect(own).not.toHaveAttribute('tabindex');
    await user.tab();
    expect(inherited).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(`request-validation${t('cell.plugin.fromService', { name: 'web' })}`);
  });

  it('is the empty mark without plugins', () => {
    const { el } = cell('plugins', route({ plugins: {} }));
    expect(el).toHaveTextContent(t('ui.empty'));
  });
});

describe('methods on one line (fix round 1, R6.8)', () => {
  it('a resize that leaves the fit as it was re-renders nothing', async () => {
    const { Profiler } = await import('react');
    const callbacks: (() => void)[] = [];
    const Original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(cb: () => void) {
        callbacks.push(cb);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    try {
      let commits = 0;
      renderWithProviders(
        <Profiler id="methods" onRender={() => commits++}>
          {col('methods').cell?.(route({ methods: ['GET', 'POST', 'PUT'] }), ctxOf())}
        </Profiler>,
        { counts: {} },
      );
      const settled = commits;
      const { act } = await import('@testing-library/react');
      act(() => {
        for (let i = 0; i < 5; i++) for (const cb of callbacks) cb();
      });
      expect(commits).toBe(settled);
    } finally {
      globalThis.ResizeObserver = Original;
    }
  });
});

describe('hosts while the services load (fix round 1, R4.1)', () => {
  it('a route that takes its hosts from a service says loading…, not "any host", until the services are in', () => {
    const loading = cell('hosts', route({ service_id: 's1' }), ctxOf({ services: [], loaded: { services: false } }));
    expect(loading.el).toHaveTextContent(t('picker.loading'));
    expect(loading.el).not.toHaveTextContent(t('cell.anyHost'));
    loading.unmount();
    const own = cell('hosts', route({ service_id: 's1', host: 'own.example' }), ctxOf({ loaded: { services: false } }));
    expect(own.el).toHaveTextContent('own.example');
    own.unmount();
    const loaded = cell('hosts', route({ service_id: 's2' }), CTX);
    expect(loaded.el).toHaveTextContent('b.example');
  });

  it('after the services read failed: "unknown", not "loading…" for ever (Task 16b, item 162)', () => {
    const failed = cell('hosts', route({ service_id: 's1' }), ctxOf({ services: [], loaded: { services: false }, failed: { services: true } }));
    expect(failed.el).toHaveTextContent(t('cell.hostsUnknown'));
    expect(failed.el).not.toHaveTextContent(t('picker.loading'));
    expect(failed.el).not.toHaveTextContent(t('cell.anyHost'));
  });
});

describe('times', () => {
  it('sorts on the stored epoch seconds', () => {
    expect(value('updated', route({ update_time: 1_700_000_000 }))).toBe(1_700_000_000);
    expect(value('created', route({ create_time: 1_600_000_000 }))).toBe(1_600_000_000);
    expect(value('updated', route({}))).toBeUndefined();
  });

  it('shows how long ago, with the date and time in a tooltip', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 14, 12), toFake: ['Date'] });
    const updated = Date.UTC(2026, 10, 12, 12) / 1000;
    const { el, user } = cell('updated', route({ update_time: updated }));
    const time = within(el).getByText(t('time.days', { n: 2 }));
    await user.hover(time);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(formatAbsolute(updated));
  });
});

describe('references', () => {
  it('names the service and plugin config, linking to them', () => {
    expect(value('service', route({ service_id: 's1' }), CTX)).toBe('web');
    expect(value('service', route({ service_id: 's2' }), CTX)).toBe('s2');
    expect(value('plugin_config', route({ plugin_config_id: 'pc1' }), CTX)).toBe('common');
    expect(value('service', route({}), CTX)).toBeUndefined();

    const service = cell('service', route({ service_id: 's1' }), CTX);
    expect(within(service.el).getByRole('link', { name: 'web' })).toHaveAttribute('href', '/services/s1');
    service.unmount();
    const config = cell('plugin_config', route({ plugin_config_id: 'pc1' }), CTX);
    expect(within(config.el).getByRole('link', { name: 'common' })).toHaveAttribute('href', '/plugin_configs/pc1');
  });

  it('flags a reference that points nowhere, and shows the empty mark when unset', () => {
    const missing = cell('service', route({ service_id: 'gone' }), CTX);
    expect(within(missing.el).getByText(t('cell.missing.services', { id: 'gone' }))).toHaveClass('ui-badge--danger');
    missing.unmount();
    const unset = cell('plugin_config', route({}), CTX);
    expect(unset.el).toHaveTextContent(t('ui.empty'));
  });
});

describe('the other optional columns', () => {
  it('id: monospace with a copy button', async () => {
    const { el, user } = cell('id', route({}, 'route-42'));
    expect(within(el).getByText('route-42')).toHaveClass('mono');
    await user.click(within(el).getByRole('button', { name: t('cell.copyId', { id: 'route-42' }) }));
    expect(await navigator.clipboard.readText()).toBe('route-42');
  });

  it('priority defaults to 0', () => {
    expect(value('priority', route({}))).toBe(0);
    expect(value('priority', route({ priority: 10 }))).toBe(10);
  });

  it('labels: key:value pairs, shown as chips', () => {
    expect(value('labels', route({ labels: { team: 'core', env: 'dev' } }))).toEqual(['team:core', 'env:dev']);
    expect(value('labels', route({}))).toEqual([]);
    const { el } = cell('labels', route({ labels: { team: 'core' } }));
    expect(el.querySelector('.cell-label')).toHaveTextContent('team:core');
  });

  it('labels: a long pair can ellipsise, its full text in the chip title only while it is cut off (known item 5)', async () => {
    const { el, user } = cell('labels', route({ labels: { 'owner-team': 'platform-infrastructure-oncall', team: 'core' } }));
    const [long, short] = [...el.querySelectorAll<HTMLElement>('.cell-label')] as [HTMLElement, HTMLElement];
    const text = long.querySelector<HTMLElement>('.cell-chip__text') as HTMLElement;
    expect(text).toHaveTextContent('owner-team:platform-infrastructure-oncall');
    clip(text);
    await user.hover(long);
    expect(long).toHaveAttribute('title', 'owner-team:platform-infrastructure-oncall');
    // The short pair shows all of itself: no title repeating it.
    await user.hover(short);
    expect(short).not.toHaveAttribute('title');
    // Wider again (the column was widened): the title goes.
    unclip(text);
    await user.unhover(long);
    await user.hover(long);
    expect(long).not.toHaveAttribute('title');
  });

  it('remote_addrs: from remote_addr or remote_addrs', () => {
    expect(value('remote_addrs', route({ remote_addr: '10.0.0.1' }))).toEqual(['10.0.0.1']);
    expect(value('remote_addrs', route({ remote_addrs: ['127.0.0.1', '10.0.0.0/8'] }))).toEqual(['127.0.0.1', '10.0.0.0/8']);
    expect(col('remote_addrs').mono).toBe(true);
  });

  it('vars: the number of conditions, nested AND/OR counted by their leaves', () => {
    expect(value('vars', route({ vars: [['arg_a', '==', '1'], ['http_x', '~~', '^a']] }))).toBe(2);
    expect(value('vars', route({ vars: ['OR', ['arg_a', '==', '1'], ['AND', ['arg_b', '==', '2'], ['arg_c', '>', 3]]] }))).toBe(3);
    expect(value('vars', route({ vars: [] }))).toBeUndefined();
    expect(value('vars', route({}))).toBeUndefined();
  });

  it('timeout: connect/send/read seconds', () => {
    expect(value('timeout', route({ timeout: { connect: 2, send: 5, read: 30 } }))).toBe('2/5/30');
    expect(value('timeout', route({}))).toBeUndefined();
  });

  it('websocket: Yes or No', () => {
    expect(value('websocket', route({ enable_websocket: true }))).toBe(true);
    expect(value('websocket', route({}))).toBe(false);
  });

  it('ssl_expiry: the soonest certificate expiry among the hosts', () => {
    const leafEnd = parseCert(RSA_LEAF)?.notAfter;
    const ctx = ctxOf({
      ssls: [
        itemOf('later', { snis: ['a.example'], validity_end: 2_000_000_000 }),
        itemOf('sooner', { snis: ['b.example'], validity_end: 1_900_000_000 }),
        itemOf('leaf', { snis: ['example.org'], cert: RSA_LEAF }),
      ],
    });
    expect(value('ssl_expiry', route({ hosts: ['a.example', 'b.example', 'none.example'] }), ctx)).toBe(1_900_000_000_000);
    expect(value('ssl_expiry', route({ host: 'example.org' }), ctx)).toBe(leafEnd);
    expect(value('ssl_expiry', route({ host: 'none.example' }), ctx)).toBeUndefined();
    expect(value('ssl_expiry', route({}), ctx)).toBeUndefined();
  });

  it('ssl_expiry: with two certificates for one SNI, the sooner of the two (APISIX serves the one it loaded first)', () => {
    const ctx = ctxOf({
      ssls: [itemOf('first', { snis: ['a.example'], validity_end: 2_000_000_000 }), itemOf('second', { snis: ['a.example'], validity_end: 1_900_000_000 })],
    });
    expect(value('ssl_expiry', route({ host: 'a.example' }), ctx)).toBe(1_900_000_000_000);
  });
});

describe('sorting', () => {
  it('by hosts follows the joined host text, host-less routes last', () => {
    const items = [
      route({ name: 'b', hosts: ['b.example'] }, 'r1'),
      route({ name: 'none' }, 'r2'),
      route({ name: 'a2', hosts: ['a.example', 'z.example'] }, 'r3'),
      route({ name: 'a1', host: 'a.example' }, 'r4'),
    ];
    const sorted = sortItems(items, [{ id: 'hosts', desc: false }], routeColumns, ctxOf());
    expect(sorted.map((i) => i.value.name)).toEqual(['a1', 'a2', 'b', 'none']);
  });

  it('by updated is numeric', () => {
    const items = [
      route({ name: 'nine', update_time: 9 }, 'r1'),
      route({ name: 'ten', update_time: 10 }, 'r2'),
      route({ name: 'hundred', update_time: 100 }, 'r3'),
    ];
    const sorted = sortItems(items, [{ id: 'updated', desc: true }], routeColumns, ctxOf());
    expect(sorted.map((i) => i.value.name)).toEqual(['hundred', 'ten', 'nine']);
  });
});
