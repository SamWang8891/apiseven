import type { ReactNode } from 'react';
import type { Item, Kind, Obj, Parent } from '../api/types';
import { t } from '../i18n';
import type { Ctx } from './ctx';
import { nameOfValue } from './resolve';

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

export interface TabProps {
  draft: Obj;
  setDraft(next: Obj): void;
  kind: Kind;
  isNew: boolean;
  ctx: Ctx;
  parent?: Parent;
}

export interface TabDef {
  id: string;
  label: string;
  render(p: TabProps): ReactNode;
  /** Top-level keys this tab owns (for error badges). */
  fields: string[];
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

export const registry: Record<Kind, ResourceDef> = {
  routes: define('routes', {
    group: 'traffic',
    hasStatus: true,
    idMode: 'optional',
    blank: () => ({ uri: '/*', status: 1 }),
  }),
  stream_routes: define('stream_routes', { group: 'traffic', hasStatus: false, idMode: 'optional' }),
  services: define('services', { group: 'traffic', hasStatus: false, idMode: 'optional' }),
  upstreams: define('upstreams', {
    group: 'traffic',
    hasStatus: false,
    idMode: 'optional',
    blank: () => ({ type: 'roundrobin', nodes: [] }),
  }),
  // A consumer's id is its username.
  consumers: define('consumers', { group: 'access', hasStatus: false, idMode: 'required' }),
  credentials: define('credentials', { group: 'access', hasStatus: false, idMode: 'required' }),
  consumer_groups: define('consumer_groups', { group: 'access', hasStatus: false, idMode: 'required' }),
  ssls: define('ssls', { group: 'access', hasStatus: true, idMode: 'optional', blank: () => ({ status: 1 }) }),
  secrets: define('secrets', { group: 'access', hasStatus: false, idMode: 'required' }),
  global_rules: define('global_rules', { group: 'plugins', hasStatus: false, idMode: 'required', blank: plugins }),
  plugin_configs: define('plugin_configs', { group: 'plugins', hasStatus: false, idMode: 'required', blank: plugins }),
  // The id is the name of the plugin the metadata belongs to.
  plugin_metadata: define('plugin_metadata', { group: 'plugins', hasStatus: false, idMode: 'fixed-list' }),
  protos: define('protos', { group: 'other', hasStatus: false, idMode: 'optional' }),
};
