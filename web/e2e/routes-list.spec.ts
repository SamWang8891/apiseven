import type { Locator, Page } from '@playwright/test';
import { ECHO, expect, openList, t, test, toast, uid, type Admin, type Json } from './fixtures';

const PREFIX = 'e2e-list-';

const SELECT_ROW = t('table.selectRow', { name: '' });
const SELECT_ALL = t('table.selectAll', { count: '\u0000' }).split('\u0000')[0]!;
const selectRow = (name: string) => t('table.selectRow', { name });

/** The routes' names in the order the table shows them (each row's "Select <name>" box). */
async function rowNames(main: Locator): Promise<string[]> {
  const labels = await main.locator('tbody').getByRole('checkbox').evaluateAll((boxes) => boxes.map((b) => b.getAttribute('aria-label') ?? ''));
  return labels.map((l) => (l.startsWith(SELECT_ROW) ? l.slice(SELECT_ROW.length) : l));
}

/** The visible column headers, in order (without the selection and actions columns). */
async function headers(main: Locator): Promise<string[]> {
  const names = await main.locator('thead th[aria-label]').evaluateAll((ths) => ths.map((th) => th.getAttribute('aria-label') ?? ''));
  return names.filter((n) => n !== t('table.actions') && !n.startsWith(SELECT_ALL));
}

function header(main: Locator, name: string): Locator {
  return main.getByRole('columnheader', { name, exact: true });
}

async function sortBy(main: Locator, name: string, opts: { shift?: boolean } = {}): Promise<void> {
  // The header's sort button (its name gains "sort N" once it is one of several sort rules).
  await header(main, name)
    .getByRole('button', { name: new RegExp(`^${name}`) })
    .click({ modifiers: opts.shift ? ['Shift'] : [] });
}

const collator = new Intl.Collator('en', { numeric: true });

/** The table's rule for a sort key: empty last both ways, text compared naturally. */
function ordered<T>(items: T[], key: (item: T) => string, desc = false): T[] {
  return [...items].sort((a, b) => {
    const [x, y] = [key(a), key(b)];
    if (!x || !y) return x === y ? 0 : x ? -1 : 1;
    return collator.compare(x, y) * (desc ? -1 : 1);
  });
}

async function storedRoutes(admin: Admin): Promise<Json[]> {
  return (await admin.list('routes')).map((r) => r.value);
}

/** What the Hosts column sorts on: the route's own hosts, else its service's (joined). */
async function hostKey(admin: Admin): Promise<(route: Json) => string> {
  const services = new Map((await admin.list('services')).map((s) => [String(s.value.id), s.value]));
  return (route) => {
    const own = Array.isArray(route.hosts) ? (route.hosts as string[]) : typeof route.host === 'string' ? [route.host] : [];
    const service = typeof route.service_id === 'string' ? services.get(route.service_id) : undefined;
    const hosts = own.length > 0 ? own : Array.isArray(service?.hosts) ? (service.hosts as string[]) : [];
    return hosts.join(', ');
  };
}

/** What a row is called: its name, else its description, else its id (resolve.ts nameOfValue). */
const nameOf = (route: Json) => String(route.name ?? route.desc ?? route.id);

test.afterAll(async () => {
  const { Admin } = await import('./admin');
  await new Admin().removePrefixed(PREFIX);
});

test.describe('columns', () => {
  test('the default columns show host, URI, methods, upstream, plugins and updated for the seeded routes', async ({ page }) => {
    const main = await openList(page, 'routes');
    expect(await headers(main)).toEqual([
      t('table.status'),
      t('column.name'),
      t('column.hosts'),
      t('column.uris'),
      t('column.methods'),
      t('column.upstream'),
      t('column.plugins'),
      t('column.updated'),
    ]);
    const row = main.getByRole('row').filter({ has: page.getByRole('checkbox', { name: selectRow('api-v1'), exact: true }) });
    await expect(row).toContainText('api.apiseven.test');
    await expect(row).toContainText('/v1/*');
    await expect(row).toContainText('GET');
    await expect(row.getByRole('link', { name: 'api-backend', exact: true })).toBeVisible();
    await expect(row).toContainText('limit-count');
    await expect(row.locator('time')).toBeVisible();
    // A route bound to a service shows the service's hosts, marked as inherited.
    const viaService = main.getByRole('row').filter({ has: page.getByRole('checkbox', { name: selectRow('web-home'), exact: true }) });
    await expect(viaService).toContainText('www.apiseven.test');
    await expect(viaService).toContainText(t('cell.viaService'));
  });

  test('hide a column, show another and move one: kept after a reload; Reset to default restores them', async ({ page }) => {
    const main = await openList(page, 'routes');
    await main.getByRole('button', { name: t('table.columns'), exact: true }).click();
    const menu = page.getByRole('dialog', { name: t('table.columns') });
    await menu.getByRole('checkbox', { name: t('column.updated'), exact: true }).click();
    await menu.getByRole('checkbox', { name: t('column.id'), exact: true }).click();
    await menu.getByRole('checkbox', { name: t('column.plugins'), exact: true }).focus();
    await page.keyboard.press('Alt+ArrowUp');
    await page.keyboard.press('Escape');
    const chosen = await headers(main);
    expect(chosen).not.toContain(t('column.updated'));
    expect(chosen).toContain(t('column.id'));
    expect(chosen.indexOf(t('column.plugins'))).toBeLessThan(chosen.indexOf(t('column.upstream')));
    await page.reload();
    await expect(header(main, t('column.id'))).toBeVisible();
    expect(await headers(main)).toEqual(chosen);

    await main.getByRole('button', { name: t('table.columns'), exact: true }).click();
    await page.getByRole('dialog', { name: t('table.columns') }).getByRole('button', { name: t('table.columns.reset') }).click();
    await page.keyboard.press('Escape');
    await expect(header(main, t('column.updated'))).toBeVisible();
    expect(await headers(main)).not.toContain(t('column.id'));
    expect((await headers(main)).indexOf(t('column.plugins'))).toBeGreaterThan((await headers(main)).indexOf(t('column.upstream')));
  });
});

test.describe('sorting', () => {
  test('by host, ascending then descending, in the order the stored hosts give', async ({ page, admin }) => {
    const main = await openList(page, 'routes');
    const routes = await storedRoutes(admin);
    const key = await hostKey(admin);
    await sortBy(main, t('column.hosts'));
    await expect(header(main, t('column.hosts'))).toHaveAttribute('aria-sort', 'ascending');
    expect(await rowNames(main)).toEqual(ordered(routes, key).map(nameOf));
    // The wildcard host sorts first; the route with no host at all is last both ways.
    expect((await rowNames(main))[0]).toBe('static-assets');
    expect((await rowNames(main)).at(-1)).toBe('healthz');
    await sortBy(main, t('column.hosts'));
    await expect(header(main, t('column.hosts'))).toHaveAttribute('aria-sort', 'descending');
    expect(await rowNames(main)).toEqual(ordered(routes, key, true).map(nameOf));
    expect((await rowNames(main)).at(-1)).toBe('healthz');
  });

  test('by updated: a route changed later sorts after (ascending) and before (descending) one changed earlier', async ({ page, admin }) => {
    const [early, late] = [`${PREFIX}early-${uid()}`, `${PREFIX}late-${uid()}`];
    const body = (name: string, host: string) => ({ name, uri: '/u', host, upstream: { type: 'roundrobin', nodes: [{ host: ECHO.host, port: ECHO.port, weight: 1 }] } });
    await admin.put(`routes/${late}`, body(late, 'late.e2e.test'));
    await admin.put(`routes/${early}`, body(early, 'early.e2e.test'));
    // update_time has a resolution of one second, on APISIX's clock: change late again until APISIX
    // stamps it later than early (no assumption that this machine's clock is APISIX's).
    const earlyTime = Number((await admin.raw(`routes/${early}`))!.update_time);
    await expect
      .poll(
        async () => {
          await admin.patch(`routes/${late}`, { desc: 'changed later' });
          return Number((await admin.raw(`routes/${late}`))!.update_time);
        },
        { timeout: 10_000, intervals: [250] },
      )
      .toBeGreaterThan(earlyTime);

    const main = await openList(page, 'routes');
    const times = new Map((await storedRoutes(admin)).map((r) => [nameOf(r), Number(r.update_time)]));
    await sortBy(main, t('column.updated'));
    await expect(header(main, t('column.updated'))).toHaveAttribute('aria-sort', 'ascending');
    let names = await rowNames(main);
    expect(names.indexOf(early)).toBeLessThan(names.indexOf(late));
    expect(names.map((n) => times.get(n)!)).toEqual([...names.map((n) => times.get(n)!)].sort((a, b) => a - b));
    await sortBy(main, t('column.updated'));
    await expect(header(main, t('column.updated'))).toHaveAttribute('aria-sort', 'descending');
    names = await rowNames(main);
    expect(names.indexOf(late)).toBeLessThan(names.indexOf(early));
    expect(names.map((n) => times.get(n)!)).toEqual([...names.map((n) => times.get(n)!)].sort((a, b) => b - a));
    await admin.del(`routes/${early}`);
    await admin.del(`routes/${late}`);
  });

  test('shift-click adds a second sort: status, then name within each status', async ({ page, admin }) => {
    const main = await openList(page, 'routes');
    await sortBy(main, t('table.status'));
    await sortBy(main, t('column.name'), { shift: true });
    await expect(header(main, t('table.status'))).toHaveAttribute('aria-sort', 'ascending');
    await expect(header(main, t('column.name'))).toHaveAttribute('aria-sort', 'ascending');
    const routes = await storedRoutes(admin);
    const disabled = ordered(routes.filter((r) => r.status === 0), nameOf).map(nameOf);
    const enabled = ordered(routes.filter((r) => r.status !== 0), nameOf).map(nameOf);
    expect(await rowNames(main)).toEqual([...disabled, ...enabled]);
    // Shift-click again flips the second rule only.
    await sortBy(main, t('column.name'), { shift: true });
    await expect(header(main, t('column.name'))).toHaveAttribute('aria-sort', 'descending');
    expect(await rowNames(main)).toEqual([...disabled, ...[...enabled].reverse()]);
  });
});

test.describe('search and filters', () => {
  test('search narrows the rows and is kept in the URL across a reload', async ({ page }) => {
    const main = await openList(page, 'routes');
    await main.getByRole('searchbox', { name: t('table.search.label', { plural: t('kind.routes.plural') }) }).fill('grpc');
    await expect.poll(() => rowNames(main)).toEqual(['grpc-greeter']);
    await expect(page).toHaveURL(/[?&]q=grpc/);
    await page.reload();
    await expect(main.getByRole('searchbox', { name: t('table.search.label', { plural: t('kind.routes.plural') }) })).toHaveValue('grpc');
    await expect.poll(() => rowNames(main)).toEqual(['grpc-greeter']);
  });

  async function filterBy(page: Page, main: Locator, chip: string, option: string): Promise<void> {
    await main.getByRole('button', { name: new RegExp(`^${chip} filter`) }).click();
    await page.getByRole('dialog', { name: chip }).getByRole('checkbox', { name: option, exact: true }).click();
    await page.keyboard.press('Escape');
  }

  const cases: [string, string, string[]][] = [
    ['table.status', t('table.status.disabled'), ['old-wiki']],
    ['filter.host', 'api.apiseven.test', ['api-v1', 'api-v2']],
    ['filter.host', t('filter.anyHost'), ['healthz']],
    ['filter.method', 'DELETE', ['api-v1']],
    ['filter.plugin', 'limit-count', ['api-v1']],
    ['filter.service', 'billing', ['billing-api']],
    ['filter.label', 'team:core', ['api-v1', 'api-v2']],
  ];
  for (const [chip, option, expected] of cases) {
    test(`the ${t(chip)} filter: ${option}`, async ({ page }) => {
      const main = await openList(page, 'routes');
      await filterBy(page, main, t(chip), option);
      await expect.poll(async () => (await rowNames(main)).sort()).toEqual(expected);
      await expect(main.getByRole('button', { name: new RegExp(`^${t(chip)} filter, 1 selected`) })).toBeVisible();
      // The filter is in the URL, and survives a reload.
      await page.reload();
      await expect.poll(async () => (await rowNames(main)).sort()).toEqual(expected);
    });
  }
});

test.describe('group by host', () => {
  test('groups each host, a group for routes with no host, and the expiry of the certificate a host is served', async ({ page }) => {
    const main = await openList(page, 'routes');
    await main.getByRole('switch', { name: t('group.byHost') }).click();
    const groups = main.getByRole('rowheader');
    await expect(groups.filter({ hasText: t('group.anyHost') })).toHaveCount(1);
    // The route without a host is in "(any host)".
    const anyHost = main.locator('tbody').filter({ has: page.getByRole('rowheader', { name: new RegExp(`^${t('group.anyHost').replace(/[()]/g, '\\$&')}`) }) });
    await expect(anyHost.getByRole('link', { name: 'healthz', exact: true })).toBeVisible();
    // api.apiseven.test is covered by the seed's *.apiseven.test certificate: its header shows the expiry.
    const covered = groups.filter({ hasText: /^api\.apiseven\.test/ });
    await expect(covered).toContainText(t('group.cert'));
    await expect(covered).toContainText(/\d+d \d{4}-\d{2}-\d{2}/);
    // wiki.example.org has none.
    await expect(groups.filter({ hasText: /^wiki\.example\.org/ })).not.toContainText(/\d+d \d{4}-\d{2}-\d{2}/);
    // The choice is kept for the next visit.
    await page.reload();
    await expect(main.getByRole('switch', { name: t('group.byHost') })).toBeChecked();
    await expect(main.getByRole('rowheader').filter({ hasText: t('group.anyHost') })).toHaveCount(1);
  });
});

test.describe('writes from the list', () => {
  const route = (host: string) => ({ uri: '/w', host, upstream: { type: 'roundrobin', nodes: [{ host: ECHO.host, port: ECHO.port, weight: 1 }] } });

  test('the status switch writes the status, both ways', async ({ page, admin }) => {
    const id = `${PREFIX}status-${uid()}`;
    await admin.put(`routes/${id}`, route('status.e2e.test'));
    const main = await openList(page, 'routes');
    const toggle = main.getByRole('switch', { name: t('table.status.toggle', { name: id }) });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect.poll(async () => (await admin.raw(`routes/${id}`))?.status).toBe(0);
    await expect(toggle).not.toBeChecked();
    // While its write is out the switch is disabled; the click waits until it can be made.
    await toggle.click();
    await expect.poll(async () => (await admin.raw(`routes/${id}`))?.status).toBe(1);
    await expect(toggle).toBeChecked();
    await admin.del(`routes/${id}`);
  });

  test('bulk Disable two routes, then bulk Delete them', async ({ page, admin }) => {
    const ids = [`${PREFIX}bulk-a-${uid()}`, `${PREFIX}bulk-b-${uid()}`];
    for (const [i, id] of ids.entries()) await admin.put(`routes/${id}`, route(`bulk${i}.e2e.test`));
    const main = await openList(page, 'routes');
    for (const id of ids) await main.getByRole('checkbox', { name: selectRow(id), exact: true }).click();
    const bar = main.getByRole('group', { name: t('table.selected', { count: 2 }) });
    await bar.getByRole('button', { name: t('action.disable'), exact: true }).click();
    await expect(toast(page, t('bulk.done', { action: t('action.disable'), done: 2 }))).toBeVisible();
    for (const id of ids) expect((await admin.raw(`routes/${id}`))?.status).toBe(0);
    // Everything else is as it was.
    expect((await admin.raw('routes/api-v1'))?.status ?? 1).toBe(1);

    for (const id of ids) {
      const box = main.getByRole('checkbox', { name: selectRow(id), exact: true });
      if (!(await box.isChecked())) await box.click();
    }
    await main.getByRole('group', { name: t('table.selected', { count: 2 }) }).getByRole('button', { name: t('action.delete'), exact: true }).click();
    const confirm = page.getByRole('alertdialog', { name: t('bulk.delete.title', { count: 2, plural: t('kind.routes.plural') }) });
    await confirm.getByRole('button', { name: t('bulk.delete.confirm', { count: 2 }) }).click();
    await expect(main.getByRole('checkbox', { name: selectRow(ids[0]!), exact: true })).toHaveCount(0);
    for (const id of ids) expect(await admin.raw(`routes/${id}`)).toBeUndefined();
    expect(await admin.raw('routes/api-v1')).toBeDefined();
  });
});

test.describe('pages', () => {
  const MANY = 60;
  const ids = Array.from({ length: MANY }, (_, i) => `${PREFIX}page-${String(i).padStart(2, '0')}`);
  /** How many routes there were before this block added its sixty. */
  let before = 0;

  test.beforeAll(async ({}, info) => {
    info.setTimeout(120_000);
    const { Admin } = await import('./admin');
    const admin = new Admin();
    before = (await admin.list('routes')).length;
    for (const id of ids) {
      await admin.put(`routes/${id}`, { uri: `/${id}`, upstream: { type: 'roundrobin', nodes: [{ host: ECHO.host, port: ECHO.port, weight: 1 }] } });
    }
  });

  test.afterAll(async () => {
    const { Admin } = await import('./admin');
    const admin = new Admin();
    for (const id of ids) await admin.del(`routes/${id}`);
  });

  test('a page size change pages the routes (sixty more than the seed), and a sort orders all of them, not one page', async ({ page, admin }) => {
    const main = await openList(page, 'routes');
    const total = (await storedRoutes(admin)).length;
    expect(total).toBe(before + MANY);
    const pages = Math.ceil(total / 25);
    expect(pages).toBeGreaterThan(2);
    const pager = main.getByRole('combobox', { name: t('table.page.size') });
    await expect(pager).toHaveText('50');
    expect(await rowNames(main)).toHaveLength(Math.min(50, total));
    await pager.click();
    await page.getByRole('option', { name: '25', exact: true }).click();
    await expect(main.getByText(t('table.page.of', { page: 1, count: pages }))).toBeVisible();
    expect(await rowNames(main)).toHaveLength(25);

    await sortBy(main, t('column.name'));
    await sortBy(main, t('column.name'));
    await expect(header(main, t('column.name'))).toHaveAttribute('aria-sort', 'descending');
    const seen: string[] = [];
    for (let p = 1; p <= pages; p++) {
      if (p > 1) await main.getByRole('button', { name: t('table.page.next') }).click();
      await expect(main.getByText(t('table.page.of', { page: p, count: pages }))).toBeVisible();
      seen.push(...(await rowNames(main)));
    }
    const all = (await storedRoutes(admin)).map(nameOf);
    expect(seen).toEqual(ordered(all.map((n) => ({ n })), (x) => x.n, true).map((x) => x.n));
    // The page size is kept.
    await page.reload();
    await expect(main.getByRole('combobox', { name: t('table.page.size') })).toHaveText('25');
  });
});
