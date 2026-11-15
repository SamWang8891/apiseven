// The credential editor's tabs: General and Plugins (the frame adds JSON). A credential holds one auth
// plugin, whose config is the key or password the consumer signs in with: the Plugins tab offers only
// auth plugins and no second one once one is set. The General body loads lazily (bodies.ts).
import { lazyPanel } from '../../editor/LazyPanel';
import { t } from '../../i18n';
import { makePluginsTab } from '../../plugins/tab';
import type { TabDef, TabProps } from '../registry';

const loading = () => <p className="ed-lazy__loading">{t('editor.lazy.loading')}</p>;
const General = lazyPanel<TabProps>(() => import('./bodies').then((m) => m.GeneralTab), loading);

export const credentialTabs: TabDef[] = [
  {
    id: 'general',
    get label() {
      return t('cr.tab.general');
    },
    fields: ['name', 'desc', 'labels'],
    render: (p) => <General {...p} />,
  },
  makePluginsTab('credential'),
];
