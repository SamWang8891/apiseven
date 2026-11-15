// The plugin config editor's tabs: General, Plugins and Used by (the frame adds JSON). Used by lists
// the routes that name it and owns no fields. The bodies load lazily, together (bodies.ts).
import type { ReactNode } from 'react';
import { lazyPanel } from '../../editor/LazyPanel';
import { t } from '../../i18n';
import type { TabDef, TabProps } from '../registry';

type Bodies = typeof import('./bodies');

const loading = () => <p className="ed-lazy__loading">{t('editor.lazy.loading')}</p>;
const body = (pick: (m: Bodies) => (p: TabProps) => ReactNode) => lazyPanel<TabProps>(() => import('./bodies').then(pick), loading);

const General = body((m) => m.GeneralTab);
const Plugins = body((m) => m.PluginsBody);
const UsedBy = body((m) => m.UsedByTab);

export const pluginConfigTabs: TabDef[] = [
  {
    id: 'general',
    get label() {
      return t('pc.tab.general');
    },
    fields: ['name', 'desc', 'labels'],
    render: (p) => <General {...p} />,
  },
  {
    id: 'plugins',
    get label() {
      return t('pl.tab');
    },
    fields: ['plugins'],
    render: (p) => <Plugins {...p} />,
  },
  {
    id: 'used_by',
    get label() {
      return t('pc.tab.usedBy');
    },
    fields: [],
    render: (p) => <UsedBy {...p} />,
  },
];
