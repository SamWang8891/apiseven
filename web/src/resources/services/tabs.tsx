// The service editor's tabs: General, Upstream, Plugins and Routes (the frame adds JSON). Each tab's
// `fields` are the top-level keys it owns, which decide where an issue or APISIX's error is badged;
// Routes lists what uses the service and owns none. `script` (a Lua script the service's routes
// inherit) has no form: it is edited in the JSON tab. The bodies load lazily, together (bodies.ts).
import type { ReactNode } from 'react';
import { lazyPanel } from '../../editor/LazyPanel';
import { t } from '../../i18n';
import { makePluginsTab } from '../../plugins/tab';
import type { TabDef, TabProps } from '../registry';

type Bodies = typeof import('./bodies');

const loading = () => <p className="ed-lazy__loading">{t('editor.lazy.loading')}</p>;
const body = (pick: (m: Bodies) => (p: TabProps) => ReactNode) => lazyPanel<TabProps>(() => import('./bodies').then(pick), loading);

const General = body((m) => m.GeneralTab);
const Upstream = body((m) => m.UpstreamTab);
const Routes = body((m) => m.RoutesTab);

export const SERVICE_GENERAL_FIELDS = ['name', 'desc', 'labels', 'hosts', 'enable_websocket'];
export const SERVICE_UPSTREAM_FIELDS = ['upstream_id', 'upstream'];

export const serviceTabs: TabDef[] = [
  {
    id: 'general',
    get label() {
      return t('svc.tab.general');
    },
    fields: SERVICE_GENERAL_FIELDS,
    render: (p) => <General {...p} />,
  },
  {
    id: 'upstream',
    get label() {
      return t('rt.tab.upstream');
    },
    fields: SERVICE_UPSTREAM_FIELDS,
    render: (p) => <Upstream {...p} />,
  },
  makePluginsTab('service'),
  {
    id: 'routes',
    get label() {
      return t('svc.tab.routes');
    },
    fields: [],
    render: (p) => <Routes {...p} />,
  },
];
