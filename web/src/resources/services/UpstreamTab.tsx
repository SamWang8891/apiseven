// The service editor's Upstream tab: an upstream object or one written inline, or none (each route
// in the service then needs its own). A service has no service of its own, so the shared control
// offers no "Service's upstream" (UpstreamSourceField with allowService={false}).
import type { TabProps } from '../registry';
import { UpstreamSourceField } from '../UpstreamSourceField';

export function UpstreamTab({ draft, setDraft, ctx, issues, isNew, kind }: TabProps) {
  return <UpstreamSourceField draft={draft} setDraft={setDraft} ctx={ctx} issues={issues} isNew={isNew} kind={kind} allowService={false} />;
}
