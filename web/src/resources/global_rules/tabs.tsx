// The global rule editor's tabs: Plugins (the frame adds JSON). A global rule is an id and its
// plugins (schema_def.lua 1021–1034); the id is the frame's (the ID field when creating, the URL
// after). The body loads lazily (bodies.ts).
import { lazyPanel } from '../../editor/LazyPanel';
import { t } from '../../i18n';
import type { TabDef, TabProps } from '../registry';

const Plugins = lazyPanel<TabProps>(
  () => import('./bodies').then((m) => m.PluginsBody),
  () => <p className="ed-lazy__loading">{t('editor.lazy.loading')}</p>,
);

export const globalRuleTabs: TabDef[] = [
  {
    id: 'plugins',
    get label() {
      return t('pl.tab');
    },
    fields: ['plugins'],
    render: (p) => <Plugins {...p} />,
  },
];
