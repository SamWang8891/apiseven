// The consumer editor's tabs: General, Plugins and Credentials (the frame adds JSON). Each tab's
// `fields` are the top-level keys it owns, which decide where an issue or APISIX's error is badged;
// Credentials lists other objects and owns none, and is left out on an APISIX without credentials
// (before 3.11). The bodies load lazily, together (bodies.ts).
import type { ReactNode } from 'react';
import { lazyPanel } from '../../editor/LazyPanel';
import { t } from '../../i18n';
import { makePluginsTab } from '../../plugins/tab';
import type { TabDef, TabProps } from '../registry';

type Bodies = typeof import('./bodies');

const loading = () => <p className="ed-lazy__loading">{t('editor.lazy.loading')}</p>;
const body = (pick: (m: Bodies) => (p: TabProps) => ReactNode) => lazyPanel<TabProps>(() => import('./bodies').then(pick), loading);

const General = body((m) => m.GeneralTab);
const Credentials = body((m) => m.CredentialsTab);

export const CONSUMER_GENERAL_FIELDS = ['username', 'desc', 'labels', 'group_id'];

export const consumerTabs: TabDef[] = [
  {
    id: 'general',
    get label() {
      return t('cs.tab.general');
    },
    fields: CONSUMER_GENERAL_FIELDS,
    render: (p) => <General {...p} />,
  },
  makePluginsTab('consumer'),
  {
    id: 'credentials',
    get label() {
      return t('cs.tab.credentials');
    },
    fields: [],
    requires: 'credentials',
    render: (p) => <Credentials {...p} />,
  },
];
