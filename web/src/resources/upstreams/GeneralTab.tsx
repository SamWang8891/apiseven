// The Upstream editor's General tab: name, description, labels, and an overview of every section
// in one line each, which is what a locked upstream reads as at a glance.
import { useId } from 'react';
import { isObj } from '../../api/sanitize';
import type { Obj } from '../../api/types';
import { setPath } from '../../editor/draft';
import { issueAt } from '../../editor/issues';
import { t } from '../../i18n';
import { Input, KeyValueInput, useLocked } from '../../ui';
import { SECTION_META } from '../../upstream/meta';
import { SUMMARIES } from '../../upstream/summary';
import { TabLink } from '../Overview';
import type { TabProps } from '../registry';
import '../resources.css';

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** One line per section, each linking to its tab. */
function Overview({ draft }: { draft: Obj }) {
  const id = useId();
  return (
    <section className="res-overview" aria-labelledby={id}>
      <h2 className="res-overview__title" id={id}>
        {t('up.overview')}
      </h2>
      <dl className="res-overview__list">
        {SECTION_META.map((meta) => (
          <div key={meta.id} className="res-overview__row">
            <dt>
              <TabLink tab={meta.id}>{meta.label}</TabLink>
            </dt>
            <dd>{SUMMARIES[meta.id](draft)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function GeneralTab({ draft, setDraft, issues }: TabProps) {
  const locked = useLocked();
  // Labels with a value that isn't text can't be edited here; they are kept as they are.
  const labels = isObj(draft.labels) ? draft.labels : {};
  const textLabels = Object.fromEntries(Object.entries(labels).filter((e): e is [string, string] => typeof e[1] === 'string'));
  const otherLabels = Object.fromEntries(Object.entries(labels).filter(([, v]) => typeof v !== 'string'));
  return (
    <div className="ed-stack">
      <div className="ed-grid">
        <Input label={t('up.general.name')} value={text(draft.name)} error={issueAt(issues, 'name')} onChange={(e) => setDraft(setPath(draft, ['name'], e.target.value))} />
        <Input label={t('up.general.desc')} value={text(draft.desc)} error={issueAt(issues, 'desc')} onChange={(e) => setDraft(setPath(draft, ['desc'], e.target.value))} />
        <div className="ed-wide">
          <KeyValueInput
            label={t('up.general.labels')}
            help={locked ? undefined : t('up.general.labelsHelp')}
            mono
            value={textLabels}
            error={issueAt(issues, 'labels')}
            onChange={(map) => setDraft(setPath(draft, ['labels'], { ...otherLabels, ...map }))}
          />
        </div>
      </div>
      <Overview draft={draft} />
    </div>
  );
}

