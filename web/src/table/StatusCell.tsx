import { Switch } from 'radix-ui';
import { useState } from 'react';
import type { Item, Kind } from '../api/types';
import { useReadOnlyKey, useWrite } from '../api/write';
import { t } from '../i18n';
import { registry } from '../resources/registry';
import { isEnabled } from '../resources/resolve';
import { Badge } from '../ui';

// Apart from the other cells (cells.tsx): this one names the object through the registry, and the
// registry's column definitions use cells.tsx.
/**
 * The status column: a switch and the state in words. Toggling PATCHes `{status}` at once and
 * shows the new state until the reloaded list confirms it; a refused write puts it back.
 */
export function StatusCell({ kind, item }: { kind: Kind; item: Item }) {
  const write = useWrite();
  const readOnly = useReadOnlyKey();
  // The state the user asked for: `saved` once APISIX accepted it, waiting for the list to catch up.
  const [pending, setPending] = useState<{ enabled: boolean; saved: boolean }>();
  const stored = isEnabled(item.value);
  if (pending?.saved && pending.enabled === stored) setPending(undefined);
  const enabled = pending?.enabled ?? stored;
  const name = registry[kind].nameOf(item);

  async function toggle(next: boolean) {
    if (pending && !pending.saved) return;
    setPending({ enabled: next, saved: false });
    const result = await write((client) => client.patch(kind, item.id, { status: next ? 1 : 0 }), { invalidate: [{ kind }] });
    setPending(result.ok ? { enabled: next, saved: true } : undefined);
  }

  return (
    <span className="tbl-status">
      <Switch.Root
        className="ui-switch"
        checked={enabled}
        disabled={readOnly}
        aria-busy={pending && !pending.saved ? true : undefined}
        aria-label={t('table.status.toggle', { name })}
        onCheckedChange={(next) => void toggle(next)}
      >
        <Switch.Thumb className="ui-switch__thumb" />
      </Switch.Root>
      <Badge tone={enabled ? 'ok' : 'neutral'}>{enabled ? t('table.status.enabled') : t('table.status.disabled')}</Badge>
    </span>
  );
}
