import { useId, useState } from 'react';
import type { Item, Kind } from '../api/types';
import { useWrite, useWriteRefusal } from '../api/write';
import { t } from '../i18n';
import { registry } from '../resources/registry';
import { isEnabled } from '../resources/resolve';
import { Badge, BusySwitch } from '../ui';

// Apart from the other cells (cells.tsx): this one names the object through the registry, and the
// registry's column definitions use cells.tsx.
/**
 * For an object whose status does nothing (ResourceDef.statusIgnored: an SSL of type client): that,
 * in words, with the reason, and no switch, since there is nothing to switch.
 */
export function StatusIgnored({ why }: { why: string }) {
  return (
    <span className="tbl-status">
      <Badge tone="neutral" title={why}>
        {t('table.status.ignored')}
      </Badge>
      <span className="ui-sr-only">{why}</span>
    </span>
  );
}

/** The status in words only, for a table that must not write (one embedded in an editor). */
export function StatusBadge({ kind, item }: { kind: Kind; item: Item }) {
  const ignored = registry[kind].statusIgnored?.(item.value);
  if (ignored !== undefined) return <StatusIgnored why={ignored} />;
  const enabled = isEnabled(item.value);
  return (
    <span className="tbl-status">
      <Badge tone={enabled ? 'ok' : 'neutral'}>{enabled ? t('table.status.enabled') : t('table.status.disabled')}</Badge>
    </span>
  );
}

/**
 * The status column: a switch and the state in words. Toggling PATCHes `{status}` at once and
 * shows the new state until the reloaded list confirms it; a refused write puts it back. While that
 * write is out the switch is busy (BusySwitch): it keeps focus, takes no change and says it is
 * saving; the state itself stays as readable as ever. With a key that turned out read-only nothing
 * is sent (api/write.ts): the switch stays where it is, focusable and unavailable (aria-disabled),
 * and says why (final wave J2), so a keyboard user whose toggle was just refused keeps their place.
 */
export function StatusCell({ kind, item }: { kind: Kind; item: Item }) {
  const write = useWrite();
  const refusal = useWriteRefusal();
  const whyId = useId();
  // The state the user asked for: `saved` once APISIX accepted it, waiting for the list to catch up.
  const [pending, setPending] = useState<{ enabled: boolean; saved: boolean }>();
  const stored = isEnabled(item.value);
  if (pending?.saved && pending.enabled === stored) setPending(undefined);
  const enabled = pending?.enabled ?? stored;
  const busy = pending !== undefined && !pending.saved;
  const name = registry[kind].nameOf(item);
  const ignored = registry[kind].statusIgnored?.(item.value);
  if (ignored !== undefined) return <StatusIgnored why={ignored} />;

  async function toggle(next: boolean) {
    if (busy || refusal !== undefined) return; // BusySwitch drops it too; a guard against a change from anywhere else.
    setPending({ enabled: next, saved: false });
    const result = await write((client) => client.patch(kind, item.id, { status: next ? 1 : 0 }), { invalidate: [{ kind }] });
    setPending(result.ok ? { enabled: next, saved: true } : undefined);
  }

  return (
    <span className="tbl-status">
      <BusySwitch
        checked={enabled}
        busy={busy}
        busyText={t('table.status.saving')}
        aria-label={t('table.status.toggle', { name })}
        aria-disabled={refusal !== undefined || undefined}
        aria-describedby={refusal !== undefined ? whyId : undefined}
        title={refusal}
        onCheckedChange={(next) => void toggle(next)}
      />
      {refusal !== undefined && (
        <span className="ui-sr-only" id={whyId}>
          {refusal}
        </span>
      )}
      <Badge tone={enabled ? 'ok' : 'neutral'}>{enabled ? t('table.status.enabled') : t('table.status.disabled')}</Badge>
    </span>
  );
}
