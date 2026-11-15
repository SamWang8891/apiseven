// The stream route editor's Upstream tab: the service the route belongs to, then where its
// connections go — the service's upstream, an upstream object, or one written inline — and what that
// resolves to (UpstreamSourceField, shared with the route and service editors). APISIX takes a stream
// route without one; it then closes the connections the route matches.
import type { TabProps } from '../registry';
import { UpstreamSourceField } from '../UpstreamSourceField';

export function UpstreamTab({ draft, setDraft, ctx, issues, isNew, kind, original }: TabProps) {
  return <UpstreamSourceField draft={draft} setDraft={setDraft} ctx={ctx} issues={issues} isNew={isNew} kind={kind} original={original} allowService />;
}
