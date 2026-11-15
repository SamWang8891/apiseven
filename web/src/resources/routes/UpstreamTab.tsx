// The route editor's Upstream tab: the service the route belongs to, then where its requests go —
// the service's upstream, an upstream object, or one written inline — and what that resolves to.
// The control is shared with the stream route and service editors (UpstreamSourceField).
import type { TabProps } from '../registry';
import { UpstreamSourceField } from '../UpstreamSourceField';

export function UpstreamTab({ draft, setDraft, ctx, issues, isNew, kind }: TabProps) {
  return <UpstreamSourceField draft={draft} setDraft={setDraft} ctx={ctx} issues={issues} isNew={isNew} kind={kind} allowService />;
}
