// The standalone Upstream editor's tabs: General (GeneralTab.tsx), then one tab per upstream form
// section. The section tabs load with the form, on first view.
import { lazyPanel } from '../../editor/LazyPanel';
import { t } from '../../i18n';
import { GENERAL_FIELDS, SECTION_META, type SectionId, type SectionMeta } from '../../upstream/meta';
import type { TabDef, TabProps } from '../registry';
import { GeneralTab } from './GeneralTab';

const SectionTab = lazyPanel<TabProps & { section: SectionId }>(
  () => import('../../upstream/SectionTab').then((m) => m.SectionTab),
  () => <p className="ed-lazy__loading">{t('editor.lazy.loading')}</p>,
);

function sectionTab(meta: SectionMeta): TabDef {
  return {
    id: meta.id,
    get label() {
      return meta.label;
    },
    fields: meta.fields,
    render: (p) => <SectionTab {...p} section={meta.id} />,
  };
}

/** General, Nodes, Load balancing, Health checks, Connection, TLS (the frame adds JSON). */
export const upstreamTabs: TabDef[] = [
  {
    id: 'general',
    get label() {
      return t('up.tab.general');
    },
    fields: GENERAL_FIELDS,
    render: (p) => <GeneralTab {...p} />,
  },
  ...SECTION_META.map(sectionTab),
];
