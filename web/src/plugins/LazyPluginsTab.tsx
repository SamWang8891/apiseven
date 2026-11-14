// The Plugins tab's UI (cards, picker, the schema form and the docs catalog) is fetched when an
// editor first shows it, so list pages do not load it. The plugin checks (validate.ts) stay in the
// main bundle: an editor's `validate` runs synchronously.
import { lazy, Suspense } from 'react';
import { t } from '../i18n';
import type { TabProps } from '../resources/registry';
import type { Scope } from './scope';

const DraftPluginsTab = lazy(() => import('./PluginsTab').then((m) => ({ default: m.DraftPluginsTab })));

export function LazyPluginsTab(props: TabProps & { scope: Scope }) {
  return (
    <Suspense fallback={<p className="pl-note">{t('pl.loading')}</p>}>
      <DraftPluginsTab {...props} />
    </Suspense>
  );
}
