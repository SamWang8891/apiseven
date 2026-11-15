import { LoaderCircle } from 'lucide-react';
import { Switch } from 'radix-ui';
import { useId, useState } from 'react';
import type { Item, Kind } from '../api/types';
import { useReadOnlyKey, useWrite } from '../api/write';
import { t } from '../i18n';
import { registry } from '../resources/registry';
import { isEnabled } from '../resources/resolve';
import { Badge } from '../ui';

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
 * write is out the switch is disabled (a click cannot be made, so none is lost) and says it is
 * saving: a spinner in its thumb, a tooltip and its accessible description; the state itself
 * stays as readable as ever. With a key that turned out read-only there is nothing to switch: the
 * state in words only (StatusBadge).
 */
export function StatusCell({ kind, item }: { kind: Kind; item: Item }) {
  const write = useWrite();
  const readOnly = useReadOnlyKey();
  const savingId = useId();
  // The state the user asked for: `saved` once APISIX accepted it, waiting for the list to catch up.
  const [pending, setPending] = useState<{ enabled: boolean; saved: boolean }>();
  const stored = isEnabled(item.value);
  if (pending?.saved && pending.enabled === stored) setPending(undefined);
  const enabled = pending?.enabled ?? stored;
  const busy = pending !== undefined && !pending.saved;
  const name = registry[kind].nameOf(item);
  const ignored = registry[kind].statusIgnored?.(item.value);
  if (ignored !== undefined) return <StatusIgnored why={ignored} />;
  if (readOnly) return <StatusBadge kind={kind} item={item} />;

  async function toggle(next: boolean) {
    if (busy) return;
    setPending({ enabled: next, saved: false });
    const result = await write((client) => client.patch(kind, item.id, { status: next ? 1 : 0 }), { invalidate: [{ kind }] });
    setPending(result.ok ? { enabled: next, saved: true } : undefined);
  }

  return (
    <span className="tbl-status">
      <Switch.Root
        className="ui-switch"
        checked={enabled}
        disabled={busy}
        aria-busy={busy || undefined}
        aria-describedby={busy ? savingId : undefined}
        title={busy ? t('table.status.saving') : undefined}
        aria-label={t('table.status.toggle', { name })}
        onCheckedChange={(next) => void toggle(next)}
      >
        <Switch.Thumb className="ui-switch__thumb">{busy && <LoaderCircle className="ui-spin ui-switch__busy" size={10} aria-hidden="true" />}</Switch.Thumb>
      </Switch.Root>
      {busy && (
        <span className="ui-sr-only" id={savingId}>
          {t('table.status.saving')}
        </span>
      )}
      <Badge tone={enabled ? 'ok' : 'neutral'}>{enabled ? t('table.status.enabled') : t('table.status.disabled')}</Badge>
    </span>
  );
}
