import { useMemo, useState, type ReactNode } from 'react';
import { useSearchPlugins } from '../api/hooks';
import type { ApiError } from '../api/errors';
import type { Item, Kind, Parent } from '../api/types';
import { t } from '../i18n';
import { registry, type ColumnDef, type Ctx } from '../resources/registry';
import { Button, ConfirmDialog, type MenuItem } from '../ui';
import { ColumnsMenu } from './ColumnsMenu';
import { withStatusColumn } from './columns';
import { FilterChip } from './FilterChip';
import { scopeOfKind } from '../plugins/scope';
import { redactObject } from '../plugins/secrets';
import { applyFilters, terms, type FilterDef, type SearchValue } from './filter';
import { Pager, SelectionBar } from './Footer';
import { Grid } from './Grid';
import { buildPage } from './rows';
import { nextSort, sortItems } from './sort';
import { EmptyState, ErrorState, NoMatchState, SearchingState } from './states';
import { useTableState } from './tableState';
import { DensityButton, NewLink, RefreshButton, SearchBox, Toolbar } from './Toolbar';
import { useView } from './useView';
import './table.css';
import './toolbar.css';

export type MenuItemFor = (item: Item) => MenuItem[];

export interface BulkAction {
  id: string;
  label: string;
  danger?: boolean;
  /** Shown, not clickable (e.g. the key is read-only). */
  disabled?: boolean;
  /** When given, DataTable asks first with these texts. */
  confirm?: (items: Item[]) => { title: string; body?: ReactNode; confirmLabel: string };
  /** Runs over the selected items (in table order); report progress as items finish. */
  run(items: Item[], progress?: (done: number, total: number) => void): Promise<void>;
}

export interface DataTableProps {
  kind: Kind;
  items: Item[];
  columns: ColumnDef[];
  ctx: Ctx;
  rowActions: MenuItemFor;
  bulkActions?: BulkAction[];
  filters?: FilterDef[];
  toolbarExtra?: ReactNode;
  /** Groups an item belongs to; an item in none goes under the last, ungrouped, group. */
  groupBy?: (item: Item) => string[];
  /** A named group's header row content; default: the group name and its item count. */
  groupHeader?: (group: string, items: Item[]) => ReactNode;
  /** The ungrouped group's name; default i18n `table.ungrouped`. */
  ungroupedLabel?: string;
  /**
   * Storage key suffix for the table state (default: the kind). Giving one also marks the table as
   * embedded: search and filters stay in memory instead of the URL, and "/" does not focus it.
   */
  stateKey?: string;
  /** The owning consumer; required for credentials (links and the New button). */
  parent?: Parent;
  loading?: boolean;
  error?: ApiError;
  onRetry?: () => void;
  /** Replaces the default "No <plural> yet" state. */
  emptyState?: ReactNode;
  /** Replaces the New button's target and text (e.g. "New route in this service" → `#/routes/new?service_id=…`). */
  newLink?: { to: string; label: string };
  /** No New button in the toolbar: a list page puts it beside its title. */
  noNewButton?: boolean;
  /**
   * Whether the status column is a switch that writes at once (a list page) or the state in words
   * (default for an embedded table: one inside an editor never writes with a single click).
   */
  statusEditable?: boolean;
}

const NO_FILTERS: FilterDef[] = [];
const NO_SELECTION: ReadonlySet<string> = new Set();

/**
 * The list table: sorts, searches and filters every item in the browser, then shows one page.
 * Column choice, order, widths, sort, page size and density persist per kind (or `stateKey`).
 */
export function DataTable(props: DataTableProps) {
  const { kind, items, columns, ctx, rowActions, bulkActions = [], filters = NO_FILTERS, toolbarExtra, groupBy, parent } = props;
  const def = registry[kind];
  const embedded = props.stateKey !== undefined;
  const statusEditable = props.statusEditable ?? !embedded;
  const allColumns = useMemo(() => withStatusColumn(kind, def.hasStatus, columns, statusEditable), [kind, def.hasStatus, columns, statusEditable]);
  const [state, patch, reset] = useTableState(props.stateKey ?? kind, allColumns);
  const [view, setView] = useView(!embedded);

  // A kind that holds secrets is searched as its locked views show it (masked), with the plugin list
  // when a page has loaded it (without it, every plugin value is masked: nothing is found by one).
  // A search in a list whose objects carry plugins loads the plugin list (which plugin fields are
  // secrets): until then every plugin value is masked, and the search says it is still looking.
  const scope = scopeOfKind[kind];
  const searched = terms(view.query).length > 0;
  const carriesPlugins = def.masksSearch === true && (scope !== undefined || kind === 'plugin_metadata');
  const pluginList = useSearchPlugins(scope === 'stream_route' ? 'stream' : undefined, carriesPlugins && searched);
  const plugins = pluginList.data;
  const searchingPlugins = carriesPlugins && searched && pluginList.loading;
  const read = useMemo<SearchValue | undefined>(() => (def.masksSearch ? (item) => redactObject(item.value, kind, plugins, item.id).value : undefined), [def, kind, plugins]);
  const filtered = useMemo(() => applyFilters(items, view.query, filters, view.selection, ctx, read), [items, view, filters, ctx, read]);
  const sorted = useMemo(() => sortItems(filtered, state.sort, allColumns, ctx), [filtered, state.sort, allColumns, ctx]);

  // The page is in memory, and back to the first one whenever what is listed, or how, changes.
  const pageKey = JSON.stringify([view, state.sort, state.pageSize]);
  const [paging, setPaging] = useState({ key: pageKey, page: 0 });
  const model = useMemo(
    () => buildPage(sorted, paging.key === pageKey ? paging.page : 0, state.pageSize, groupBy),
    [sorted, paging, pageKey, state.pageSize, groupBy],
  );

  // Selected ids; a row the search or filters no longer show drops out of the selection.
  const [selected, setSelected] = useState(NO_SELECTION);
  const shownIds = useMemo(() => new Set(filtered.map((i) => i.id)), [filtered]);
  if ([...selected].some((id) => !shownIds.has(id))) setSelected(new Set([...selected].filter((id) => shownIds.has(id))));
  const selectedItems = useMemo(() => sorted.filter((i) => selected.has(i.id)), [sorted, selected]);

  /** The bulk action waiting for its confirmation; it is about the selection as it is now (rows gone meanwhile drop out of it). */
  const [confirming, setConfirming] = useState<BulkAction>();
  if (confirming && selectedItems.length === 0) setConfirming(undefined);
  const [progress, setProgress] = useState<{ done: number; total: number }>();

  async function runBulk(action: BulkAction, list: Item[]) {
    setConfirming(undefined);
    setProgress({ done: 0, total: list.length });
    try {
      await action.run(list, (done, total) => setProgress({ done, total }));
    } finally {
      setProgress(undefined);
    }
  }

  const byId = new Map(allColumns.map((c) => [c.id, c]));
  const shown = state.order.filter((id) => state.visible.includes(id)).flatMap((id) => byId.get(id) ?? []);
  const selectable = bulkActions.length > 0;
  const plural = def.plural;
  const narrowed = terms(view.query).length > 0 || Object.values(view.selection).some((v) => v.length > 0);
  const clearView = () => setView({ query: '', selection: {} });

  const toolbar = (
    <Toolbar
      search={
        <SearchBox value={view.query} onChange={(query) => setView({ ...view, query })} label={t('table.search.label', { plural })} shortcut={!embedded} />
      }
      filters={
        <>
          {filters.map((filter) => (
            <FilterChip
              key={filter.id}
              filter={filter}
              items={items}
              ctx={ctx}
              selected={view.selection[filter.id] ?? []}
              onChange={(values) => setView({ ...view, selection: { ...view.selection, [filter.id]: values } })}
            />
          ))}
        </>
      }
      count={
        // A list page shows the total beside its title; embedded tables have no title.
        props.loading || props.error
          ? null
          : narrowed
            ? t('table.countFiltered', { shown: filtered.length, total: items.length })
            : embedded
              ? t('page.count', { count: items.length })
              : null
      }
      end={
        <>
          <ColumnsMenu
            columns={allColumns}
            order={state.order}
            visible={state.visible}
            onChange={(next) => patch(next)}
            onReset={reset}
          />
          <DensityButton compact={state.density === 'compact'} onChange={(compact) => patch({ density: compact ? 'compact' : 'comfortable' })} />
          <RefreshButton kind={kind} parent={parent} />
          {toolbarExtra}
          {!props.noNewButton && <NewLink kind={kind} parent={parent} to={props.newLink?.to} label={props.newLink?.label} />}
        </>
      }
    />
  );

  let body: ReactNode;
  if (props.error && props.error.kind !== 'auth') {
    body = <ErrorState plural={plural} error={props.error} onRetry={props.onRetry} />;
  } else if (!props.loading && items.length === 0) {
    body = props.emptyState ?? <EmptyState kind={kind} parent={parent} />;
  } else if (!props.loading && filtered.length === 0) {
    body = searchingPlugins ? <SearchingState /> : <NoMatchState plural={plural} onClear={clearView} />;
  } else {
    body = (
      <Grid
        kind={kind}
        ctx={ctx}
        parent={parent}
        groupHeader={props.groupHeader}
        ungroupedLabel={props.ungroupedLabel}
        columns={shown}
        widths={state.widths}
        sort={state.sort}
        rows={props.loading ? undefined : model.rows}
        selectable={selectable}
        selected={selected}
        allSelected={filtered.length > 0 && selected.size === filtered.length ? true : selected.size > 0 ? 'indeterminate' : false}
        matchCount={filtered.length}
        onSelect={(id, on) => {
          const next = new Set(selected);
          if (on) next.add(id);
          else next.delete(id);
          setSelected(next);
        }}
        onSelectAll={(on) => setSelected(on ? new Set(filtered.map((i) => i.id)) : NO_SELECTION)}
        onSort={(id, multi) => patch({ sort: nextSort(state.sort, id, multi) })}
        onResize={(id, width) => patch({ widths: { ...state.widths, [id]: width } })}
        onResetWidth={(id) => {
          const rest = { ...state.widths };
          delete rest[id];
          patch({ widths: rest });
        }}
        rowActions={rowActions}
      />
    );
  }

  const showFooter = !props.loading && !props.error && filtered.length > 0;
  return (
    <div className={`tbl tbl--${state.density}${embedded ? ' tbl--embedded' : ''}`}>
      {toolbar}
      {searchingPlugins && filtered.length > 0 && (
        <p className="tbl-searching" role="status">
          {t('table.search.plugins')}
        </p>
      )}
      <div className="tbl-scroll">{body}</div>
      {showFooter && (
        <div className="tbl-foot">
          {selected.size > 0 && (
            <SelectionBar
              count={selected.size}
              progress={progress}
              onClear={() => setSelected(NO_SELECTION)}
              actions={bulkActions.map((action) => (
                <Button
                  key={action.id}
                  size="sm"
                  variant={action.danger ? 'danger' : 'secondary'}
                  disabled={action.disabled || progress !== undefined}
                  onClick={() => (action.confirm ? setConfirming(action) : void runBulk(action, selectedItems))}
                >
                  {action.label}
                </Button>
              ))}
            />
          )}
          <Pager
            model={model}
            pageSize={state.pageSize}
            onPage={(page) => setPaging({ key: pageKey, page })}
            onPageSize={(pageSize) => patch({ pageSize })}
          />
        </div>
      )}
      {confirming?.confirm && selectedItems.length > 0 && (
        <ConfirmDialog
          open
          danger={confirming.danger}
          {...confirming.confirm(selectedItems)}
          onConfirm={() => void runBulk(confirming, selectedItems)}
          onCancel={() => setConfirming(undefined)}
        />
      )}
    </div>
  );
}
