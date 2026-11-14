// One upstream section as a tab of the standalone Upstream editor (loaded with the form, see
// resources/upstreams/tabs.tsx): the section's fields over the whole draft.
import type { TabProps } from '../resources/registry';
import type { SectionId } from './meta';
import { upstreamSections } from './sections';
import './upstream.css';

export function SectionTab({ section, draft, setDraft, issues, ctx }: TabProps & { section: SectionId }) {
  const s = upstreamSections.find((candidate) => candidate.id === section);
  return <div className="up up--tab">{s?.render({ value: draft, onChange: setDraft, issues, ctx })}</div>;
}
