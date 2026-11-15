// The consumer group editor's General tab: its name, description and labels. The group's id is the
// frame's (the ID field when creating, the URL after); its plugins and its consumers have tabs of
// their own.
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
        labels={{ name: t('cg.general.name'), desc: t('cg.general.desc'), labels: t('cg.general.labels'), labelsHelp: t('cg.general.labelsHelp') }}
      />
    </div>
  );
}
