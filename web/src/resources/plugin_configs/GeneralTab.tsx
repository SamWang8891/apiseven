// The plugin config editor's General tab: its name, description and labels. Its id is the frame's
// (the ID field when creating, the URL after); its plugins and the routes that use it have tabs of
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
        labels={{ name: t('pc.general.name'), desc: t('pc.general.desc'), labels: t('pc.general.labels'), labelsHelp: t('pc.general.labelsHelp') }}
      />
    </div>
  );
}
