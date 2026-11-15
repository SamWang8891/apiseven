// The proto editor's General tab: its name, description and labels. Its id is the frame's (optional
// when creating: APISIX generates one); the definition has a tab of its own (Content).
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
        labels={{ name: t('pr.general.name'), desc: t('pr.general.desc'), labels: t('pr.general.labels'), labelsHelp: t('pr.general.labelsHelp') }}
      />
    </div>
  );
}
