import type { ReactNode } from 'react';
import type { Item, Kind, Obj, Parent, PluginInfo } from '../api/types';
import type { Issue } from '../editor/issues';
import { t } from '../i18n';
import type { Scope } from '../plugins/scope';
import { makePluginsTab } from '../plugins/tab';
import { pluginIssues } from '../plugins/validate';
import type { FilterDef } from '../table/filter';
import type { Ctx } from './ctx';
import { nameOfValue } from './resolve';
import { routeColumns } from './routes/columns';
import { routeFilters } from './routes/filters';
import { hostGrouping } from './routes/grouping';
import { routeTabs } from './routes/tabs';
import { routeIssues } from './routes/validate';
import { upstreamColumns } from './upstreams/columns';
import { upstreamFilters } from './upstreams/filters';
import { upstreamTabs } from './upstreams/tabs';
import { upstreamIssues } from '../upstream/validate';

export type { Ctx } from './ctx';
export { useCtx } from './ctx';

export interface ColumnDef {
  id: string;
  header: string;
  /** The sortable / filterable value. */
  accessor(item: Item, ctx: Ctx): unknown;
  cell?(item: Item, ctx: Ctx): ReactNode;
  defaultVisible: boolean;
  width?: number;
  mono?: boolean;
}

/**
 * What the editor frame hands each tab. The draft is the whole object; a tab writes only its own
 * fields (with setPath / setPathRaw from editor/draft.ts) and calls setDraft once per change with the
 * complete next object. Everything a tab shows comes from the draft: only the active tab is mounted.
 */
export interface TabProps {
  draft: Obj;
  setDraft: (next: Obj) => void;
  kind: Kind;
  isNew: boolean;
  ctx: Ctx;
  parent?: Parent;
  /** The issues attributed to this tab: client-side ones from `validate`, and APISIX's error once it names one of its fields. */
  issues: Issue[];
  /** The stored object as loaded (timestamps included); undefined for a new object. */
  original?: Item;
  /**
   * Save attempts blocked by issues since editing began (0 after every lock). A tab can react to a
   * new one, e.g. the Plugins tab opens the cards that have issues.
   */
  saveAttempts: number;
}

export interface TabDef {
  id: string;
  label: string;
  render(p: TabProps): ReactNode;
  /** Top-level keys this tab owns: an issue or APISIX error about one of them badges this tab. */
  fields: string[];
}

/** What `validate` may consult besides the draft. */
export interface ValidateEnv {
  isNew: boolean;
  ctx: Ctx;
  /** Every http plugin with its schemas (useAllPlugins().data); undefined until loaded. */
  plugins?: Record<string, PluginInfo>;
  /** Every stream plugin (useAllPlugins('stream').data), for kinds whose plugins run in the stream subsystem; undefined until loaded and for other kinds. */
  streamPlugins?: Record<string, PluginInfo>;
}

/** A way to group a list's rows (a toggle on the list page); one item can sit in several groups. */
export interface Grouping {
  id: string;
  /** The toggle's text, e.g. "Group by host". */
  label: string;
  /** The groups an item belongs to; [] puts it in the ungrouped group, which comes last. */
  groupBy(item: Item, ctx: Ctx): string[];
  /** A named group's header row content; default: the group name and its item count. */
  header?(group: string, items: Item[], ctx: Ctx): ReactNode;
  /** The ungrouped group's name; default i18n `table.ungrouped`. */
  ungroupedLabel?: string;
}

export interface ResourceDef {
  kind: Kind;
  group: 'traffic' | 'access' | 'plugins' | 'other';
  /** From i18n `kind.<kind>.singular` / `.plural`, read on each access. */
  singular: string;
  plural: string;
  hasStatus: boolean;
  nameOf(item: Item): string;
  columns: ColumnDef[];
  tabs: TabDef[];
  /** A fresh object on every call. */
  blank(): Obj;
  /**
   * How a new object gets its id: `optional` (APISIX generates one when left out), `required` (the
   * kind has no POST, so the caller picks it), `fixed-list` (a plugin name).
   */
  idMode: 'optional' | 'required' | 'fixed-list';
  /** Quick-filter chips on the list page. */
  filters?: FilterDef[];
  /** Row groupings the list page offers, one at a time. */
  groupings?: Grouping[];
  /**
   * Client-side checks of a draft, run on every change; Save is blocked while any issue remains.
   * Pure. Set `tab` on an issue when its path's first segment is not in that tab's `fields`.
   */
  validate?(draft: Obj, env: ValidateEnv): Issue[];
  /** For kinds whose id is a field of the body (a consumer's `username`): the frame shows no ID input. */
  idFromDraft?(draft: Obj): string | undefined;
  /**
   * Search params the create page copies into a new object (`#/routes/new?service_id=s1` starts
   * with `service_id: 's1'`); any other param is ignored.
   */
  prefill?: string[];
}

/** name → username → desc → id. */
function nameOf(item: Item): string {
  return nameOfValue(item.value) ?? item.id;
}

// Headers and kind names are getters so they follow the language table at use. Spreading a def or a
// column copies their current text instead: build new entries with define() or a fresh literal.
function baseColumns(): ColumnDef[] {
  return [
    {
      id: 'id',
      get header() {
        return t('column.id');
      },
      accessor: (item) => item.id,
      defaultVisible: true,
      mono: true,
    },
    {
      id: 'name',
      get header() {
        return t('column.name');
      },
      accessor: (item) => nameOf(item),
      defaultVisible: true,
    },
  ];
}

type Spec = Omit<ResourceDef, 'kind' | 'singular' | 'plural' | 'nameOf' | 'columns' | 'tabs' | 'blank'> &
  Partial<Pick<ResourceDef, 'columns' | 'tabs' | 'blank'>>;

function define(kind: Kind, spec: Spec): ResourceDef {
  return {
    kind,
    get singular() {
      return t(`kind.${kind}.singular`);
    },
    get plural() {
      return t(`kind.${kind}.plural`);
    },
    nameOf,
    columns: baseColumns(),
    tabs: [],
    blank: () => ({}),
    ...spec,
  };
}

const plugins = (): Obj => ({ plugins: {} });

/**
 * What every plugin-bearing kind shares: the Plugins tab and the plugin checks, for its scope.
 * Spread into a define() spec (a fresh object each call; a ResourceDef itself is never spread).
 */
const withPlugins = (scope: Scope): Pick<ResourceDef, 'tabs' | 'validate'> => ({
  tabs: [makePluginsTab(scope)],
  validate: (draft, env) => pluginIssues(draft, env, scope),
});

export const registry: Record<Kind, ResourceDef> = {
  routes: define('routes', {
    group: 'traffic',
    hasStatus: true,
    idMode: 'optional',
    blank: () => ({ uri: '/*', status: 1 }),
    tabs: routeTabs,
    // Includes the plugin checks (pluginIssues) and the inline upstream's (upstreamIssues).
    validate: (draft, env) => routeIssues(draft, env),
    prefill: ['service_id', 'upstream_id', 'plugin_config_id'],
    columns: routeColumns,
    filters: routeFilters,
    groupings: [hostGrouping],
  }),
  stream_routes: define('stream_routes', { group: 'traffic', hasStatus: false, idMode: 'optional', ...withPlugins('stream_route') }),
  services: define('services', { group: 'traffic', hasStatus: false, idMode: 'optional', ...withPlugins('service') }),
  upstreams: define('upstreams', {
    group: 'traffic',
    hasStatus: false,
    idMode: 'optional',
    blank: () => ({ type: 'roundrobin', nodes: [] }),
    tabs: upstreamTabs,
    columns: upstreamColumns,
    filters: upstreamFilters,
    validate: (draft) => upstreamIssues(draft),
  }),
  // A consumer's id is its username.
  consumers: define('consumers', {
    group: 'access',
    hasStatus: false,
    idMode: 'required',
    ...withPlugins('consumer'),
    idFromDraft: (draft) => (typeof draft.username === 'string' && draft.username !== '' ? draft.username : undefined),
  }),
  credentials: define('credentials', { group: 'access', hasStatus: false, idMode: 'required', ...withPlugins('credential') }),
  consumer_groups: define('consumer_groups', { group: 'access', hasStatus: false, idMode: 'required', ...withPlugins('consumer_group') }),
  ssls: define('ssls', { group: 'access', hasStatus: true, idMode: 'optional', blank: () => ({ status: 1 }) }),
  secrets: define('secrets', { group: 'access', hasStatus: false, idMode: 'required' }),
  global_rules: define('global_rules', { group: 'plugins', hasStatus: false, idMode: 'required', blank: plugins, ...withPlugins('global_rule') }),
  plugin_configs: define('plugin_configs', { group: 'plugins', hasStatus: false, idMode: 'required', blank: plugins, ...withPlugins('plugin_config') }),
  // The id is the name of the plugin the metadata belongs to.
  plugin_metadata: define('plugin_metadata', { group: 'plugins', hasStatus: false, idMode: 'fixed-list' }),
  protos: define('protos', { group: 'other', hasStatus: false, idMode: 'optional' }),
};
