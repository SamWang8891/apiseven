// The plugin metadata editor's tabs: Settings (the frame adds JSON). Settings owns every key but the
// id (restFields): each plugin's metadata has its own. The body loads lazily (bodies.ts).
import { lazyPanel } from '../../editor/LazyPanel';
import { t } from '../../i18n';
import type { TabDef, TabProps } from '../registry';

const Config = lazyPanel<TabProps>(
  () => import('./bodies').then((m) => m.ConfigTab),
  () => <p className="ed-lazy__loading">{t('editor.lazy.loading')}</p>,
);

export const metadataTabs: TabDef[] = [
  {
    id: 'config',
    get label() {
      return t('pm.tab.config');
    },
    fields: [],
    restFields: true,
    render: (p) => <Config {...p} />,
  },
];
