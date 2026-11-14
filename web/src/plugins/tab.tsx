// The generic Plugins tab of a plugin-bearing kind: PluginsTab bound to the draft's `plugins`.
import { t } from '../i18n';
import type { TabDef } from '../resources/registry';
import { LazyPluginsTab } from './LazyPluginsTab';
import type { Scope } from './scope';

/** The Plugins tab for `scope`: id 'plugins', owning the `plugins` field (a route's also lists what it inherits). */
export function makePluginsTab(scope: Scope): TabDef {
  return {
    id: 'plugins',
    get label() {
      return t('pl.tab');
    },
    fields: ['plugins'],
    render: (p) => <LazyPluginsTab {...p} scope={scope} />,
  };
}
