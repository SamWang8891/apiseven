import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { Item, Kind } from '../api/types';
import { t } from '../i18n';
import { registry, type ColumnDef, type Ctx } from '../resources/registry';
import { ctxOf, itemOf } from '../test/ctx';
import { locationOf, renderWithProviders } from '../test/providers';
import { DataTable, type DataTableProps } from './DataTable';
import type { FilterDef } from './filter';
import { tableStorageKey } from './tableState';

afterEach(() => localStorage.clear());

const COLUMNS: ColumnDef[] = [
  { id: 'name', header: 'Name', accessor: (item) => item.value.name, defaultVisible: true },
  { id: 'host', header: 'Host', accessor: (item) => item.value.host, defaultVisible: true, mono: true },
  { id: 'priority', header: 'Priority', accessor: (item) => item.value.priority, defaultVisible: true },
  { id: 'tags', header: 'Tags', accessor: (item) => item.value.tags, defaultVisible: true },
  { id: 'ws', header: 'WebSocket', accessor: (item) => item.value.ws, defaultVisible: true },
  { id: 'id', header: 'ID', accessor: (item) => item.id, defaultVisible: false, mono: true },
];

const TEAM: FilterDef = {
  id: 'team',
  label: 'Team',
  options: (items) =>
    [...new Set(items.map((i) => String(i.value.team)))].sort().map((value) => ({ value, label: value })),
  matches: (item, selected) => selected.includes(String(item.value.team)),
};

function renderTable(props: Partial<DataTableProps> & { items: Item[] }, path = '/routes') {
  const user = userEvent.setup();
  const ctx: Ctx = ctxOf();
  const kind: Kind = props.kind ?? 'upstreams';
  const ui = <DataTable kind={kind} columns={COLUMNS} ctx={ctx} rowActions={() => []} {...props} />;
  return { user, ...renderWithProviders(ui, { path, counts: {} }) };
}

const table = () => screen.getByRole('table');
/** Names in the order the rows show them (the name column links to each object). */
const names = () => within(table()).queryAllByRole('link').map((a) => a.textContent);
const header = (name: string) => within(table()).getByRole('columnheader', { name: new RegExp(`^${name}`) });
const sortButton = (name: string) => within(header(name)).getByRole('button', { name: new RegExp(`^${name}`) });
const headerNames = () =>
  within(table())
    .getAllByRole('columnheader')
    .map((th) => th.textContent)
    .filter((text) => text && COLUMNS.some((c) => text.startsWith(c.header)));

describe('sorting', () => {
  const items = [
    itemOf('r1', { name: 'web', priority: 10 }),
    itemOf('r2', { name: 'api', priority: 2 }),
    itemOf('r3', { name: 'r10', priority: 2 }),
    itemOf('r4', { name: 'api-2', priority: 10 }),
    itemOf('r5', { name: 'r2' }),
  ];

  it('sorts by a header click, adds a second rule on shift-click, and keeps empties last both ways', async () => {
    const { user } = renderTable({ items });
    await user.click(sortButton('Priority'));
    // Ascending: 2, 2, 10, 10, then r5 without a priority; equal keys keep their order.
    expect(names()).toEqual(['api', 'r10', 'web', 'api-2', 'r2']);
    expect(header('Priority')).toHaveAttribute('aria-sort', 'ascending');

    await user.click(sortButton('Priority'));
    expect(names()).toEqual(['web', 'api-2', 'api', 'r10', 'r2']);
    expect(header('Priority')).toHaveAttribute('aria-sort', 'descending');

    await user.keyboard('{Shift>}');
    await user.click(sortButton('Name'));
    await user.keyboard('{/Shift}');
    // Priority desc, then name asc: 10 → api-2, web; 2 → api, r10; empty → r2.
    expect(names()).toEqual(['api-2', 'web', 'api', 'r10', 'r2']);
    expect(header('Name')).toHaveAttribute('aria-sort', 'ascending');
    expect(within(header('Priority')).getByText('1')).toBeInTheDocument();
    expect(within(header('Name')).getByText('2')).toBeInTheDocument();
  });

  it('cycles a column asc → desc → unsorted, with natural order for numeric text', async () => {
    const { user } = renderTable({ items });
    expect(header('Name')).toHaveAttribute('aria-sort', 'none');
    await user.click(sortButton('Name'));
    expect(names()).toEqual(['api', 'api-2', 'r2', 'r10', 'web']);
    await user.click(sortButton('Name'));
    expect(names()).toEqual(['web', 'r10', 'r2', 'api-2', 'api']);
    await user.click(sortButton('Name'));
    expect(names()).toEqual(['web', 'api', 'r10', 'api-2', 'r2']);
    expect(header('Name')).toHaveAttribute('aria-sort', 'none');
  });

  it('remembers the sort across a remount', async () => {
    const first = renderTable({ items });
    await first.user.click(sortButton('Name'));
    first.unmount();
    renderTable({ items });
    expect(names()).toEqual(['api', 'api-2', 'r2', 'r10', 'web']);
  });
});

describe('paging', () => {
  const many = Array.from({ length: 3000 }, (_, i) => itemOf(`r${i + 1}`, { name: `route-${i + 1}`, priority: (i * 7919) % 3000 }));

  it('renders one page of 3,000 items, while sorting orders all of them', async () => {
    const { user, container } = renderTable({ items: many });
    expect(container.querySelectorAll('tr').length).toBeLessThan(200);
    expect(names()).toHaveLength(50);

    await user.click(sortButton('Priority'));
    await user.click(sortButton('Priority'));
    // Priorities are a permutation of 0..2999: the highest is 2999, the lowest 0.
    const byPriority = [...many].sort((a, b) => (b.value.priority as number) - (a.value.priority as number));
    expect(names()[0]).toBe(byPriority[0]?.value.name);

    await user.click(screen.getByRole('button', { name: t('table.page.last') }));
    expect(screen.getByText(t('table.page.of', { page: 60, count: 60 }))).toBeInTheDocument();
    expect(names().at(-1)).toBe(byPriority.at(-1)?.value.name);
    expect(container.querySelectorAll('tr').length).toBeLessThan(200);
  });

  it('changes the page size, which returns to page 1 and is remembered', async () => {
    const { user } = renderTable({ items: many.slice(0, 120) });
    await user.click(screen.getByRole('button', { name: t('table.page.next') }));
    expect(screen.getByText(t('table.page.of', { page: 2, count: 3 }))).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: t('table.page.size') }));
    await user.click(await screen.findByRole('option', { name: '100' }));
    expect(screen.getByText(t('table.page.of', { page: 1, count: 2 }))).toBeInTheDocument();
    expect(names()).toHaveLength(100);
    expect(JSON.parse(localStorage.getItem(tableStorageKey('upstreams')) ?? '{}')).toMatchObject({ pageSize: 100 });
  });
});

describe('empty states', () => {
  it('with zero items shows the empty state, what the kind is for, and a New link to the create page (known item 12)', () => {
    renderTable({ items: [], kind: 'routes' });
    const empty = screen.getByRole('region', { name: t('table.empty.title', { plural: t('kind.routes.plural') }) });
    expect(within(empty).getByText(t('kind.routes.about'))).toBeInTheDocument();
    expect(within(empty).getByRole('link', { name: t('page.new', { kind: t('kind.routes.singular') }) })).toHaveAttribute(
      'href',
      '/routes/new',
    );
  });

  it('every kind says in one sentence what it is for', () => {
    for (const kind of Object.keys(registry) as Kind[]) {
      const about = t(`kind.${kind}.about`);
      expect(about, kind).not.toBe(`kind.${kind}.about`);
      expect(about.split(/[.!?](\s|$)/).filter((s) => s.trim()).length, kind).toBe(1);
    }
  });

  it('with no matches offers to clear the search and filters', async () => {
    const { user, router } = renderTable({ items: [itemOf('r1', { name: 'web', team: 'a' })], filters: [TEAM] }, '/routes?q=nothing&f.team=a');
    const none = screen.getByRole('region', { name: t('table.empty.noMatch', { plural: t('kind.upstreams.plural') }) });
    await user.click(within(none).getByRole('button', { name: t('table.clearFilters') }));
    expect(names()).toEqual(['web']);
    expect(locationOf(router)).toBe('/routes');
  });

  it('shows skeleton rows while loading and the error with a retry button', async () => {
    let retried = 0;
    const { unmount } = renderTable({ items: [], loading: true });
    expect(screen.getByRole('status', { name: t('table.loading', { plural: t('kind.upstreams.plural') }) })).toBeInTheDocument();
    unmount();

    const { ApiError } = await import('../api/errors');
    const { user } = renderTable({ items: [], error: new ApiError('http', 'HTTP 500: etcd down', { status: 500 }), onRetry: () => retried++ });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('HTTP 500: etcd down');
    await user.click(within(alert).getByRole('button', { name: t('table.retry') }));
    expect(retried).toBe(1);
  });
});

describe('columns menu', () => {
  const items = [itemOf('r1', { name: 'web', host: 'a.example', priority: 1 })];
  const openColumns = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: t('table.columns') }));
    return within(await screen.findByRole('dialog', { name: t('table.columns.title') }));
  };

  it('hides a column, and the choice persists across a remount', async () => {
    const first = renderTable({ items });
    const menu = await openColumns(first.user);
    await first.user.click(menu.getByRole('checkbox', { name: 'Host' }));
    expect(headerNames()).toEqual(['Name', 'Priority', 'Tags', 'WebSocket']);
    first.unmount();
    renderTable({ items });
    expect(headerNames()).toEqual(['Name', 'Priority', 'Tags', 'WebSocket']);
  });

  it('keeps at least one column visible', async () => {
    const { user } = renderTable({ items });
    const menu = await openColumns(user);
    for (const name of ['Host', 'Priority', 'Tags', 'WebSocket']) await user.click(menu.getByRole('checkbox', { name }));
    expect(headerNames()).toEqual(['Name']);
    const last = menu.getByRole('checkbox', { name: 'Name' });
    expect(last).toBeChecked();
    expect(last).toBeDisabled();
  });

  it('reorders with Alt+arrow keys, keeping focus on the moved column, and shows hidden columns when ticked', async () => {
    const { user } = renderTable({ items });
    const menu = await openColumns(user);
    menu.getByRole('checkbox', { name: 'Name' }).focus();
    await user.keyboard('{Alt>}{ArrowDown}{ArrowDown}{/Alt}');
    expect(headerNames()).toEqual(['Host', 'Priority', 'Name', 'Tags', 'WebSocket']);
    expect(menu.getByRole('checkbox', { name: 'Name' })).toHaveFocus();
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}');
    expect(headerNames()).toEqual(['Host', 'Name', 'Priority', 'Tags', 'WebSocket']);
    await user.click(menu.getByRole('checkbox', { name: 'ID' }));
    expect(headerNames()).toEqual(['Host', 'Name', 'Priority', 'Tags', 'WebSocket', 'ID']);
  });

  it('reorders by dragging', async () => {
    const { user } = renderTable({ items });
    const menu = await openColumns(user);
    const { fireEvent } = await import('@testing-library/react');
    const handle = (name: string) => menu.getByRole('checkbox', { name }).closest('li') as HTMLElement;
    fireEvent.dragStart(handle('Tags'));
    fireEvent.dragOver(handle('Name'));
    fireEvent.drop(handle('Name'));
    expect(headerNames()).toEqual(['Tags', 'Name', 'Host', 'Priority', 'WebSocket']);
  });

  it('"Reset to default" restores the default order and visibility', async () => {
    const { user } = renderTable({ items });
    const menu = await openColumns(user);
    await user.click(menu.getByRole('checkbox', { name: 'Host' }));
    menu.getByRole('checkbox', { name: 'Name' }).focus();
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await user.click(menu.getByRole('button', { name: t('table.columns.reset') }));
    expect(headerNames()).toEqual(['Name', 'Host', 'Priority', 'Tags', 'WebSocket']);
  });
});

describe('column widths (known item 9: the edge works from the keyboard)', () => {
  const items = [itemOf('r1', { name: 'web', host: 'a.example', priority: 1 })];
  const edge = (name: string) => within(header(name)).getByRole('separator', { name: t('table.resizeLabel', { column: name }) });
  const stored = () => (JSON.parse(localStorage.getItem(tableStorageKey('upstreams')) ?? '{}') as { widths?: Record<string, number> }).widths;

  it('each header edge is a focusable vertical separator with its width as the value', async () => {
    const { user } = renderTable({ items });
    const host = edge('Host');
    expect(host).toHaveAttribute('aria-orientation', 'vertical');
    expect(host).toHaveAttribute('aria-valuenow', '160');
    expect(host).toHaveAttribute('aria-valuetext', t('table.resizeValue', { width: 160 }));
    // In the tab order, right after its column's sort button.
    sortButton('Host').focus();
    await user.tab();
    expect(host).toHaveFocus();
  });

  it('Left and Right resize (Shift for bigger steps), the width is kept, and Enter resets it', async () => {
    const first = renderTable({ items });
    edge('Host').focus();
    await first.user.keyboard('{ArrowRight}{ArrowRight}');
    expect(edge('Host')).toHaveAttribute('aria-valuenow', '180');
    await first.user.keyboard('{Shift>}{ArrowLeft}{/Shift}');
    expect(edge('Host')).toHaveAttribute('aria-valuenow', '130');
    expect(edge('Host')).toHaveFocus();
    expect(stored()).toEqual({ host: 130 });
    first.unmount();
    const again = renderTable({ items });
    expect(edge('Host')).toHaveAttribute('aria-valuenow', '130');
    edge('Host').focus();
    await again.user.keyboard('{Enter}');
    expect(edge('Host')).toHaveAttribute('aria-valuenow', '160');
  });

  it('never goes below the narrowest width', async () => {
    const { user } = renderTable({ items });
    edge('Priority').focus();
    for (let i = 0; i < 5; i++) await user.keyboard('{Shift>}{ArrowLeft}{/Shift}');
    expect(edge('Priority')).toHaveAttribute('aria-valuenow', '60');
  });
});

describe('search and filters', () => {
  const items = [
    itemOf('r1', { name: 'api', team: 'web' }),
    itemOf('r2', { name: 'shop', team: 'web' }),
    itemOf('r3', { name: 'billing-api', team: 'ops' }),
    itemOf('r4', { name: 'admin', team: 'data' }),
  ];

  it('a filter offers the values in the data; two selected keep items matching either', async () => {
    const { user, router } = renderTable({ items, filters: [TEAM] });
    await user.click(screen.getByRole('button', { name: t('table.filter.label', { label: 'Team' }) }));
    const popover = within(await screen.findByRole('dialog', { name: 'Team' }));
    expect(popover.getAllByRole('checkbox').map((c) => c.closest('label')?.textContent)).toEqual(['data', 'ops', 'web']);
    await user.click(popover.getByRole('checkbox', { name: 'ops' }));
    await user.click(popover.getByRole('checkbox', { name: 'data' }));
    expect(names()).toEqual(['billing-api', 'admin']);
    expect(screen.getByRole('button', { name: t('table.filter.labelCount', { label: 'Team', count: 2 }) })).toBeInTheDocument();
    expect(new URLSearchParams(router.state.location.search).get('f.team')).toBe('ops,data');
  });

  it('restores the query and filters from the URL (?q=foo&f.status=1), and a reload keeps them', async () => {
    const STATUS: FilterDef = {
      id: 'status',
      label: 'Status',
      options: () => [
        { value: '1', label: 'Enabled' },
        { value: '0', label: 'Disabled' },
      ],
      matches: (item, selected) => selected.includes(item.value.status === 0 ? '0' : '1'),
    };
    const routes = [
      itemOf('r1', { name: 'foo-on', status: 1 }),
      itemOf('r2', { name: 'foo-off', status: 0 }),
      itemOf('r3', { name: 'bar-on', status: 1 }),
      itemOf('r4', { name: 'foo-default' }),
    ];
    const first = renderTable({ items: routes, filters: [STATUS] }, '/routes?q=foo&f.status=1');
    expect(screen.getByRole('searchbox')).toHaveValue('foo');
    expect(screen.getByRole('button', { name: t('table.filter.labelCount', { label: 'Status', count: 1 }) })).toBeInTheDocument();
    expect(names()).toEqual(['foo-on', 'foo-default']);
    expect(screen.getByText(t('table.countFiltered', { shown: 2, total: 4 }))).toBeInTheDocument();

    await first.user.clear(screen.getByRole('searchbox'));
    await first.user.type(screen.getByRole('searchbox'), 'bar');
    expect(names()).toEqual(['bar-on']);
    await waitFor(() => expect(new URLSearchParams(first.router.state.location.search).get('q')).toBe('bar'));
    const url = locationOf(first.router);
    expect(new URLSearchParams(url.split('?')[1]).get('f.status')).toBe('1');
    first.unmount();

    // "Reload": a fresh table at the URL the first one left.
    renderTable({ items: routes, filters: [STATUS] }, url);
    expect(screen.getByRole('searchbox')).toHaveValue('bar');
    expect(names()).toEqual(['bar-on']);
  });

  it('changing the query returns to page 1', async () => {
    const many = Array.from({ length: 120 }, (_, i) => itemOf(`r${i + 1}`, { name: `route-${i + 1}` }));
    const { user } = renderTable({ items: many });
    await user.click(screen.getByRole('button', { name: t('table.page.next') }));
    expect(screen.getByText(t('table.page.of', { page: 2, count: 3 }))).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox'), 'route-1');
    expect(screen.getByText(t('table.page.of', { page: 1, count: 1 }))).toBeInTheDocument();
  });

  it('embedded tables (stateKey) keep the query out of the URL', async () => {
    const { user, router } = renderTable({ items, stateKey: 'services.routes' });
    await user.type(screen.getByRole('searchbox'), 'shop');
    expect(names()).toEqual(['shop']);
    expect(locationOf(router)).toBe('/routes');
  });

  it('"/" focuses the search box unless typing in a field; Escape clears it', async () => {
    const { user } = renderTable({ items });
    await user.keyboard('/');
    const search = screen.getByRole('searchbox');
    expect(search).toHaveFocus();
    expect(search).toHaveValue('');
    await user.type(search, 'shop/');
    expect(search).toHaveValue('shop/');
    await user.keyboard('{Escape}');
    expect(search).toHaveValue('');
    expect(names()).toHaveLength(4);
  });
});

describe('selection', () => {
  const many = Array.from({ length: 120 }, (_, i) => itemOf(`r${i + 1}`, { name: `${i % 3 === 0 ? 'keep' : 'drop'}-${i + 1}` }));
  // Rows get checkboxes when there is something to do with a selection.
  const bulkActions = [{ id: 'noop', label: 'Noop', run: async () => {} }];

  it('has no checkboxes without bulk actions', () => {
    renderTable({ items: many.slice(0, 3) });
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('select-all takes every row matching the search, across pages', async () => {
    const { user } = renderTable({ items: many, bulkActions }, '/routes?q=keep');
    // 40 of 120 match; the page shows all 40 at 50 per page, so use a smaller page to cross pages.
    await user.click(screen.getByRole('combobox', { name: t('table.page.size') }));
    await user.click(await screen.findByRole('option', { name: '25' }));
    expect(names()).toHaveLength(25);
    await user.click(screen.getByRole('checkbox', { name: t('table.selectAll', { count: 40 }) }));
    expect(screen.getByText(t('table.selected', { count: 40 }))).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: t('table.selectAll', { count: 40 }) })).toBeChecked();
  });

  it('marks select-all as mixed for a partial selection, and drops rows the filter hides', async () => {
    const { user } = renderTable({ items: many.slice(0, 6), bulkActions });
    await user.click(screen.getByRole('checkbox', { name: t('table.selectRow', { name: 'keep-1' }) }));
    await user.click(screen.getByRole('checkbox', { name: t('table.selectRow', { name: 'drop-2' }) }));
    expect(screen.getByRole('checkbox', { name: t('table.selectAll', { count: 6 }) })).toHaveAttribute('aria-checked', 'mixed');
    expect(screen.getByText(t('table.selected', { count: 2 }))).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox'), 'keep');
    expect(screen.getByText(t('table.selected', { count: 1 }))).toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox'));
    expect(screen.getByText(t('table.selected', { count: 1 }))).toBeInTheDocument();
  });

  it('runs a bulk action on the selection, confirming first and showing progress', async () => {
    const seen: string[][] = [];
    let release: () => void = () => {};
    const { user } = renderTable({
      items: many.slice(0, 3),
      bulkActions: [
        {
          id: 'zap',
          label: 'Zap',
          danger: true,
          confirm: (list) => ({ title: `Zap ${list.length}?`, confirmLabel: 'Zap them' }),
          run: async (list, progress) => {
            seen.push(list.map((i) => i.id));
            progress?.(1, list.length);
            await new Promise<void>((resolve) => (release = resolve));
          },
        },
      ],
    });
    await user.click(screen.getByRole('checkbox', { name: t('table.selectAll', { count: 3 }) }));
    await user.click(screen.getByRole('button', { name: 'Zap' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Zap 3?' });
    await user.click(within(dialog).getByRole('button', { name: 'Zap them' }));
    expect(seen).toEqual([['r1', 'r2', 'r3']]);
    expect(await screen.findByText(t('table.bulk.progress', { done: 1, total: 3 }))).toBeInTheDocument();
    release();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });
});

describe('groups', () => {
  const items = [
    itemOf('r1', { name: 'both', hosts: ['b.example', 'a.example'] }),
    itemOf('r2', { name: 'only-a', hosts: ['a.example'] }),
    itemOf('r3', { name: 'none', hosts: [] }),
  ];
  const groupBy = (item: Item) => item.value.hosts as string[];
  /** Group header and row names, top to bottom. */
  const layout = () =>
    within(table())
      .getAllByRole('row')
      .slice(1)
      .map((row) => {
        const head = within(row).queryByRole('rowheader');
        return head ? `# ${head.textContent}` : within(row).getByRole('link').textContent;
      });

  it('lists an item under each of its groups, and items without a group last', () => {
    renderTable({ items, groupBy, ungroupedLabel: '(any host)' });
    expect(layout()).toEqual(['# a.example2', 'both', 'only-a', '# b.example1', 'both', '# (any host)1', 'none']);
  });

  it('uses groupHeader for named groups and the i18n label for the ungrouped one by default', () => {
    renderTable({ items, groupBy, groupHeader: (group, list) => `${group} has ${list.length}` });
    expect(layout()).toEqual([
      '# a.example has 2', 'both', 'only-a', '# b.example has 1', 'both', `# ${t('table.ungrouped')}1`, 'none',
    ]);
  });

  it('repeats the group header on a page that starts mid-group', async () => {
    const many = Array.from({ length: 30 }, (_, i) => itemOf(`r${i + 1}`, { name: `route-${i + 1}`, hosts: ['one.example'] }));
    const { user } = renderTable({ items: many, groupBy });
    await user.click(screen.getByRole('combobox', { name: t('table.page.size') }));
    await user.click(await screen.findByRole('option', { name: '25' }));
    await user.click(screen.getByRole('button', { name: t('table.page.next') }));
    expect(layout()).toEqual(['# one.example30', 'route-26', 'route-27', 'route-28', 'route-29', 'route-30']);
  });
});

describe('cells', () => {
  it('renders the default cells: links, stacked arrays, Yes/No and the empty mark', async () => {
    const { user } = renderTable({
      items: [
        itemOf('r1', { name: 'web', host: 'a.example', tags: ['t1', 't2', 't3', 't4', 't5'], ws: true }),
        itemOf('r2', { tags: [], ws: false, priority: 0 }),
      ],
    });
    const rows = within(table()).getAllByRole('row').slice(1);
    const [first, second] = rows as [HTMLElement, HTMLElement];
    expect(within(first).getByRole('link', { name: 'web' })).toHaveAttribute('href', '/upstreams/r1');
    expect(within(first).getByText('a.example')).toHaveClass('mono');
    expect(within(first).getByText('t3')).toBeInTheDocument();
    expect(within(first).queryByText('t4')).not.toBeInTheDocument();
    const more = within(first).getByRole('button', { name: t('table.more', { count: 2 }) });
    expect(within(first).getByText(t('ui.yes'))).toBeInTheDocument();
    await user.hover(more);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('t1t2t3t4t5');

    // Without a name, the link to the object shows its id.
    expect(within(second).getByRole('link', { name: 'r2' })).toHaveAttribute('href', '/upstreams/r2');
    const cells = within(second).getAllByRole('cell');
    expect(cells.map((c) => c.textContent)).toEqual(expect.arrayContaining([t('ui.empty'), '0', t('ui.no')]));
    // host (unset) and tags ([]) are empty; priority 0 and `false` are values.
    expect(cells.filter((c) => c.textContent === t('ui.empty'))).toHaveLength(2);
  });
});

describe('status (fix round 1: a table in an editor never writes with one click)', () => {
  const routes = [itemOf('r1', { name: 'web', status: 1 }), itemOf('r2', { name: 'old', status: 0 })];

  it('a list page offers the switch', () => {
    renderTable({ kind: 'routes', items: routes });
    expect(within(table()).getAllByRole('switch')).toHaveLength(2);
  });

  it('an embedded table (stateKey) shows the status as words only: nothing to click, nothing written', () => {
    const { admin } = renderTable({ kind: 'routes', items: routes, stateKey: 'services.routes' });
    expect(within(table()).queryAllByRole('switch')).toEqual([]);
    expect(within(table()).getByText(t('table.status.enabled'))).toBeInTheDocument();
    expect(within(table()).getByText(t('table.status.disabled'))).toBeInTheDocument();
    expect(admin.requests.filter((r) => r.method !== 'GET')).toEqual([]);
  });

  it('statusEditable decides either way', () => {
    renderTable({ kind: 'routes', items: routes, stateKey: 'x.routes', statusEditable: true });
    expect(within(table()).getAllByRole('switch')).toHaveLength(2);
  });

  it('the table marks its own view controls (search, columns, pager) for editableControls to skip', () => {
    renderTable({ kind: 'routes', items: routes, stateKey: 'services.routes' });
    expect(screen.getByRole('searchbox').closest('[data-view-control]')).not.toBeNull();
    expect(screen.getByRole('combobox', { name: t('table.page.size') }).closest('[data-view-control]')).not.toBeNull();
  });
});

