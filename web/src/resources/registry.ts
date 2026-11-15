import type { ComponentType, ReactNode, Ref } from 'react';
import type { Item, Kind, Obj, Parent, PluginInfo } from '../api/types';
import type { Issue } from '../editor/issues';
import { t } from '../i18n';
import type { FilterDef } from '../table/filter';
import type { Ctx } from './ctx';
import { nameOfValue } from './resolve';
import { routeColumns } from './routes/columns';
import { routeFilters } from './routes/filters';
import { hostGrouping } from './routes/grouping';
import { routeTabs } from './routes/tabs';
import { routeIssues } from './routes/validate';
import { serviceColumns } from './services/columns';
import { serviceFilters } from './services/filters';
import { serviceTabs } from './services/tabs';
import { serviceIssues } from './services/validate';
import { streamRouteColumns } from './stream_routes/columns';
import { streamRouteTabs } from './stream_routes/tabs';
import { streamRouteIssues } from './stream_routes/validate';
import { upstreamColumns } from './upstreams/columns';
import { upstreamFilters } from './upstreams/filters';
import { upstreamTabs } from './upstreams/tabs';
import { upstreamIssues } from '../upstream/validate';
import { consumerColumns } from './consumers/columns';
import { consumerFilters } from './consumers/filters';
import { consumerTabs } from './consumers/tabs';
import { consumerIssues } from './consumers/validate';
import { credentialColumns } from './credentials/columns';
import { credentialTabs } from './credentials/tabs';
import { credentialIssues } from './credentials/validate';
import { consumerGroupColumns } from './consumer_groups/columns';
import { consumerGroupTabs } from './consumer_groups/tabs';
import { consumerGroupIssues } from './consumer_groups/validate';
import { sslColumns } from './ssls/columns';
import { sslFilters } from './ssls/filters';
import { sslTabs } from './ssls/tabs';
import { sniNames, statusApplies } from './ssls/usage';
import { sslIssues } from './ssls/validate';
import { globalRuleColumns } from './global_rules/columns';
import { globalRuleTabs } from './global_rules/tabs';
import { globalRuleIssues } from './global_rules/validate';
import { pluginConfigColumns } from './plugin_configs/columns';
import { pluginConfigFilters } from './plugin_configs/filters';
import { pluginConfigTabs } from './plugin_configs/tabs';
import { pluginConfigIssues } from './plugin_configs/validate';
import { metadataColumns } from './plugin_metadata/columns';
import { MetadataListPage } from './plugin_metadata/ListPage';
import { NewMetadataId } from './plugin_metadata/NewMetadataId';
import { metadataTabs } from './plugin_metadata/tabs';
import { metadataIdProblem, metadataIssues } from './plugin_metadata/validate';
import { protoColumns } from './protos/columns';
import { protoTabs } from './protos/tabs';
import { protoIssues } from './protos/validate';
import { secretColumns } from './secrets/columns';
import { secretFilters } from './secrets/filters';
import { NewSecretId } from './secrets/NewSecretId';
import { secretTabs } from './secrets/tabs';
import { secretIdProblem, secretIssues } from './secrets/validate';

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
  /** false: the header is not a sort button (a value each row fetches on its own has none to sort by). */
  sortable?: boolean;
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
  /**
   * The object's id: the stored one, or for a new object the id chosen so far (the ID field, a kind's
   * NewId, an id fixed by the page); undefined while there is none. A secret's tab reads its manager
   * from it, a plugin metadata's tab its plugin.
   */
  id?: string;
}

export interface TabDef {
  id: string;
  label: string;
  render(p: TabProps): ReactNode;
  /** Top-level keys this tab owns: an issue or APISIX error about one of them badges this tab. */
  fields: string[];
  /**
   * Also owns every top-level key that no other tab names (but `id`): a form over a schema the kind
   * cannot list in advance (a plugin's metadata), so APISIX's error about one of them badges it.
   */
  restFields?: boolean;
  /**
   * A kind the tab lists or edits that older APISIX versions lack (a consumer's credentials, 3.11+):
   * the frame leaves the tab out once useSupports(kind) says false, and shows it while that is unknown.
   */
  requires?: Kind;
}

/** What `validate` may consult besides the draft. */
export interface ValidateEnv {
  isNew: boolean;
  ctx: Ctx;
  /** Every http plugin with its schemas (useAllPlugins().data); undefined until loaded. */
  plugins?: Record<string, PluginInfo>;
  /** Every stream plugin (useAllPlugins('stream').data), for kinds whose plugins run in the stream subsystem; undefined until loaded and for other kinds. */
  streamPlugins?: Record<string, PluginInfo>;
  /**
   * The stored object as loaded (undefined for a new one): what APISIX merges a PATCH into, for the
   * one kind saved that way without its whole value (an SSL without a new key, editor/save.ts).
   */
  original?: Item;
  /** The object's id, as TabProps.id has it (a new object's: the one chosen so far). */
  id?: string;
}

/** What a kind's own ID control for a new object gets (ResourceDef.NewId). */
export interface NewIdProps {
  /** The id chosen so far ('' while none). */
  value: string;
  onChange: (id: string) => void;
  draft: Obj;
  /** Replaces the draft (a no-op while saving): a secret manager's blank when the manager changes. */
  setDraft: (next: Obj) => void;
  /** What is wrong with the id: missing after a Save was tried, taken, or refused (ResourceDef.idProblem). */
  error?: string;
  /** For the control that takes the id, so a refused Save can focus it. */
  inputRef?: Ref<HTMLInputElement>;
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
  /** That field's path (a consumer's `username`): where the frame says an id is taken. */
  idField?: string;
  /**
   * Search params the create page copies into a new object (`#/routes/new?service_id=s1` starts
   * with `service_id: 's1'`); any other param is ignored.
   */
  prefill?: string[];
  /**
   * For kinds with a status: why it does nothing for this object, when it does nothing (an SSL of
   * type client, which APISIX uses whatever its status). The editor's header and the list then say
   * so instead of offering a switch.
   */
  statusIgnored?(value: Obj): string | undefined;
  /** Replaces the frame's ID input for a new object (a secret's manager and id, a plugin metadata's plugin). */
  NewId?: ComponentType<NewIdProps>;
  /** Replaces the generic list page (plugin metadata lists every plugin that has metadata settings). */
  ListComponent?: ComponentType<{ kind: Kind }>;
  /**
   * The editor of an id nothing is stored under opens in create mode for that id (unlocked, from the
   * blank) instead of "not found": a plugin's metadata exists or not, but its page always does.
   */
  createWhenMissing?: boolean;
  /**
   * Why a new object's id can't be taken as it is (a secret's id with a slash, which APISIX would
   * cut), naming the field; Save is refused meanwhile and the message is its toast.
   */
  idProblem?(id: string): string | undefined;
  /** The kind has no Duplicate (one plugin metadata entry per plugin). */
  noDuplicate?: boolean;
  /** Deleting an object resets something rather than removing a thing of its own (plugin metadata): the actions and dialog say Reset. */
  resets?: boolean;
  /**
   * The list's search reads each object as the locked views show it (redactObject), so it never
   * finds one by a secret it holds.
   */
  masksSearch?: boolean;
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
  Partial<Pick<ResourceDef, 'columns' | 'tabs' | 'blank' | 'nameOf'>>;

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
  stream_routes: define('stream_routes', {
    group: 'traffic',
    hasStatus: false,
    idMode: 'optional',
    tabs: streamRouteTabs,
    // Includes the plugin checks (the stream set) and the inline upstream's (the schema's only).
    validate: (draft, env) => streamRouteIssues(draft, env),
    prefill: ['service_id', 'upstream_id'],
    columns: streamRouteColumns,
  }),
  services: define('services', {
    group: 'traffic',
    hasStatus: false,
    idMode: 'optional',
    tabs: serviceTabs,
    // Includes the plugin checks and the inline upstream's.
    validate: (draft, env) => serviceIssues(draft, env),
    columns: serviceColumns,
    filters: serviceFilters,
  }),
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
  // A consumer's id is its username: the frame shows no ID field and creates PUT consumers/<username>.
  consumers: define('consumers', {
    group: 'access',
    hasStatus: false,
    idMode: 'required',
    tabs: consumerTabs,
    // Includes the plugin checks (the consumer schemas).
    validate: (draft, env) => consumerIssues(draft, env),
    idFromDraft: (draft) => (typeof draft.username === 'string' && draft.username !== '' ? draft.username : undefined),
    idField: 'username',
    // A group's "New consumer in this group" starts a consumer in it.
    prefill: ['group_id'],
    columns: consumerColumns,
    filters: consumerFilters,
  }),
  // Lives under its consumer (EditorFrame's `parent`): /consumers/<username>/credentials/<id>.
  credentials: define('credentials', {
    group: 'access',
    hasStatus: false,
    idMode: 'required',
    tabs: credentialTabs,
    validate: (draft, env) => credentialIssues(draft, env),
    columns: credentialColumns,
  }),
  consumer_groups: define('consumer_groups', {
    group: 'access',
    hasStatus: false,
    idMode: 'required',
    blank: plugins,
    tabs: consumerGroupTabs,
    validate: (draft, env) => consumerGroupIssues(draft, env),
    columns: consumerGroupColumns,
  }),
  ssls: define('ssls', {
    group: 'access',
    hasStatus: true,
    idMode: 'optional',
    blank: () => ({ status: 1 }),
    tabs: sslTabs,
    validate: (draft, env) => sslIssues(draft, env),
    columns: sslColumns,
    filters: sslFilters,
    // An SSL has no name: its first SNI reads best in titles, delete dialogs and search.
    nameOf: (item) => sniNames(item.value)[0] ?? item.id,
    statusIgnored: (value) => (statusApplies(value) ? undefined : t('ssl.status.ignored')),
  }),
  // A secret's id is "<manager>/<id>" (vault/my-id): two path segments (api/client.ts), picked by NewSecretId.
  secrets: define('secrets', {
    group: 'access',
    hasStatus: false,
    idMode: 'required',
    tabs: secretTabs,
    validate: (draft, env) => secretIssues(draft, env),
    columns: secretColumns,
    filters: secretFilters,
    nameOf: (item) => item.id,
    NewId: NewSecretId,
    idProblem: secretIdProblem,
    masksSearch: true,
  }),
  global_rules: define('global_rules', {
    group: 'plugins',
    hasStatus: false,
    idMode: 'required',
    blank: plugins,
    tabs: globalRuleTabs,
    // Includes the plugin checks.
    validate: (draft, env) => globalRuleIssues(draft, env),
    columns: globalRuleColumns,
    nameOf: (item) => item.id,
    masksSearch: true,
  }),
  plugin_configs: define('plugin_configs', {
    group: 'plugins',
    hasStatus: false,
    idMode: 'required',
    blank: plugins,
    tabs: pluginConfigTabs,
    // Includes the plugin checks.
    validate: (draft, env) => pluginConfigIssues(draft, env),
    columns: pluginConfigColumns,
    filters: pluginConfigFilters,
    masksSearch: true,
  }),
  // The id is the name of the plugin the metadata belongs to. Its list shows every plugin that has
  // metadata settings; its page exists whether or not an entry does; one entry per plugin, so no
  // Duplicate; deleting it resets the plugin's metadata.
  plugin_metadata: define('plugin_metadata', {
    group: 'plugins',
    hasStatus: false,
    idMode: 'fixed-list',
    tabs: metadataTabs,
    validate: (draft, env) => metadataIssues(draft, env),
    columns: metadataColumns,
    nameOf: (item) => item.id,
    NewId: NewMetadataId,
    ListComponent: MetadataListPage,
    createWhenMissing: true,
    idProblem: metadataIdProblem,
    noDuplicate: true,
    resets: true,
    masksSearch: true,
  }),
  protos: define('protos', {
    group: 'other',
    hasStatus: false,
    idMode: 'optional',
    tabs: protoTabs,
    validate: (draft) => protoIssues(draft),
    columns: protoColumns,
  }),
};
