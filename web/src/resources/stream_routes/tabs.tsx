// The stream route editor's tabs: General, Matching, Upstream, Plugins and Advanced (the frame adds
// JSON). Each tab's `fields` are the top-level keys it owns, which decide where an issue or APISIX's
// error is badged; together they are every field of the stream_route schema but id and the
// timestamps. The bodies load lazily, together (bodies.ts).
import type { ReactNode } from 'react';
import { lazyPanel } from '../../editor/LazyPanel';
import { t } from '../../i18n';
import { makePluginsTab } from '../../plugins/tab';
import type { TabDef, TabProps } from '../registry';

type Bodies = typeof import('./bodies');

const loading = () => <p className="ed-lazy__loading">{t('editor.lazy.loading')}</p>;
const body = (pick: (m: Bodies) => (p: TabProps) => ReactNode) => lazyPanel<TabProps>(() => import('./bodies').then(pick), loading);

const General = body((m) => m.GeneralTab);
const Matching = body((m) => m.MatchingTab);
const Upstream = body((m) => m.UpstreamTab);
const Advanced = body((m) => m.AdvancedTab);

export const STREAM_GENERAL_FIELDS = ['name', 'desc', 'labels'];
export const STREAM_MATCHING_FIELDS = ['server_addr', 'server_port', 'remote_addr', 'sni', 'snis'];
export const STREAM_UPSTREAM_FIELDS = ['service_id', 'upstream_id', 'upstream'];
export const STREAM_ADVANCED_FIELDS = ['protocol', 'tls_passthrough'];

export const streamRouteTabs: TabDef[] = [
  {
    id: 'general',
    get label() {
      return t('sr.tab.general');
    },
    fields: STREAM_GENERAL_FIELDS,
    render: (p) => <General {...p} />,
  },
  {
    id: 'matching',
    get label() {
      return t('sr.tab.matching');
    },
    fields: STREAM_MATCHING_FIELDS,
    render: (p) => <Matching {...p} />,
  },
  {
    id: 'upstream',
    get label() {
      return t('rt.tab.upstream');
    },
    fields: STREAM_UPSTREAM_FIELDS,
    render: (p) => <Upstream {...p} />,
  },
  makePluginsTab('stream_route'),
  {
    id: 'advanced',
    get label() {
      return t('sr.tab.advanced');
    },
    fields: STREAM_ADVANCED_FIELDS,
    render: (p) => <Advanced {...p} />,
  },
];
