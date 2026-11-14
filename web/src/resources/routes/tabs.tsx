// The route editor's tabs: General, Matching, Upstream, Plugins and Advanced (the frame adds JSON).
// Each tab's `fields` are the top-level keys it owns, which decide where an issue or APISIX's error
// is badged. The bodies load lazily, together (bodies.ts), so list pages and the entry bundle don't
// carry them.
import type { ReactNode } from 'react';
import { lazyPanel } from '../../editor/LazyPanel';
import { t } from '../../i18n';
import type { TabDef, TabProps } from '../registry';

type Bodies = typeof import('./bodies');

const loading = () => <p className="ed-lazy__loading">{t('editor.lazy.loading')}</p>;
const body = (pick: (m: Bodies) => (p: TabProps) => ReactNode) => lazyPanel<TabProps>(() => import('./bodies').then(pick), loading);

const General = body((m) => m.GeneralTab);
const Matching = body((m) => m.MatchingTab);
const Upstream = body((m) => m.UpstreamTab);
const Plugins = body((m) => m.RoutePluginsTab);
const Advanced = body((m) => m.AdvancedTab);

export const GENERAL_FIELDS = ['name', 'desc', 'labels', 'priority'];
export const MATCHING_FIELDS = ['host', 'hosts', 'uri', 'uris', 'methods', 'remote_addr', 'remote_addrs', 'vars', 'filter_func'];
export const UPSTREAM_FIELDS = ['service_id', 'upstream_id', 'upstream'];
export const PLUGINS_FIELDS = ['plugins', 'plugin_config_id'];
export const ADVANCED_FIELDS = ['timeout', 'enable_websocket', 'script', 'script_id'];

export const routeTabs: TabDef[] = [
  {
    id: 'general',
    get label() {
      return t('rt.tab.general');
    },
    fields: GENERAL_FIELDS,
    render: (p) => <General {...p} />,
  },
  {
    id: 'matching',
    get label() {
      return t('rt.tab.matching');
    },
    fields: MATCHING_FIELDS,
    render: (p) => <Matching {...p} />,
  },
  {
    id: 'upstream',
    get label() {
      return t('rt.tab.upstream');
    },
    fields: UPSTREAM_FIELDS,
    render: (p) => <Upstream {...p} />,
  },
  {
    id: 'plugins',
    get label() {
      return t('pl.tab');
    },
    fields: PLUGINS_FIELDS,
    render: (p) => <Plugins {...p} />,
  },
  {
    id: 'advanced',
    get label() {
      return t('rt.tab.advanced');
    },
    fields: ADVANCED_FIELDS,
    render: (p) => <Advanced {...p} />,
  },
];
