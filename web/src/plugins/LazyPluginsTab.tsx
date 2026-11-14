// The Plugins tab's UI (cards, picker, the schema form and the docs catalog) is fetched when an
// editor first shows it, so list pages do not load it. The plugin checks (validate.ts) stay in the
// main bundle: an editor's `validate` runs synchronously. A failed fetch shows a Retry in the tab
// and leaves the editor (and its draft) as it is.
import { lazyPanel } from '../editor/LazyPanel';
import { t } from '../i18n';
import type { TabProps } from '../resources/registry';
import type { Scope } from './scope';

export const LazyPluginsTab = lazyPanel<TabProps & { scope: Scope }>(
  () => import('./PluginsTab').then((m) => m.DraftPluginsTab),
  () => <p className="pl-note">{t('pl.loading')}</p>,
);
