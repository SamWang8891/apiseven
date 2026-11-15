// The credential editor's General tab: its name, description and labels. The credential's id is the
// frame's (the ID field when creating, the URL after), and its one auth plugin, with the key or
// password, is on the Plugins tab.
import { t } from '../../i18n';
import { MetaFields } from '../MetaFields';
import type { TabProps } from '../registry';

export function GeneralTab({ draft, setDraft, issues }: TabProps) {
  return (
    <div className="ed-grid">
      <MetaFields
        draft={draft}
        setDraft={setDraft}
        issues={issues}
        labels={{ name: t('cr.general.name'), desc: t('cr.general.desc'), labels: t('cr.general.labels'), labelsHelp: t('cr.general.labelsHelp') }}
      />
    </div>
  );
}
