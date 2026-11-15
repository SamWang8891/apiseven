// The consumer group editor's tabs: General, Plugins and Consumers (the frame adds JSON). A group's
// plugins are checked like a route's (admin/consumer_group.lua passes no schema type) and run for
// its consumers' requests. Consumers lists the members and owns no fields. The bodies load lazily,
// together (bodies.ts).
import type { ReactNode } from 'react';
import { lazyPanel } from '../../editor/LazyPanel';
import { t } from '../../i18n';
import { makePluginsTab } from '../../plugins/tab';
import type { TabDef, TabProps } from '../registry';

type Bodies = typeof import('./bodies');

const loading = () => <p className="ed-lazy__loading">{t('editor.lazy.loading')}</p>;
const body = (pick: (m: Bodies) => (p: TabProps) => ReactNode) => lazyPanel<TabProps>(() => import('./bodies').then(pick), loading);

const General = body((m) => m.GeneralTab);
const Members = body((m) => m.MembersTab);

export const consumerGroupTabs: TabDef[] = [
  {
    id: 'general',
    get label() {
      return t('cg.tab.general');
    },
    fields: ['name', 'desc', 'labels'],
    render: (p) => <General {...p} />,
  },
  makePluginsTab('consumer_group'),
  {
    id: 'members',
    get label() {
      return t('cg.tab.members');
    },
    fields: [],
    render: (p) => <Members {...p} />,
  },
];
