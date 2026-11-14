import { t } from '../i18n';
import { ConfirmDialog, type PendingEntry } from '../ui';

/** Asks before unsaved changes are thrown away: leaving the page, or Discard. */
export function DiscardDialog({ open, name, onConfirm, onCancel }: { open: boolean; name: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <ConfirmDialog
      open={open}
      danger
      title={t('editor.leave.title')}
      body={<p>{t('editor.leave.body', { name })}</p>}
      confirmLabel={t('editor.leave.confirm')}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

/**
 * Asks before a tab switch throws away input the active tab holds outside the draft (usePending),
 * listing what would go: "Discard and switch" or "Stay".
 */
export function PendingDialog({ open, kind, pending, onConfirm, onCancel }: { open: boolean; kind: string; pending: PendingEntry[]; onConfirm: () => void; onCancel: () => void }) {
  return (
    <ConfirmDialog
      open={open}
      danger
      title={t('editor.pending.title')}
      body={
        <>
          <p>{t('editor.pending.body', { kind })}</p>
          <ul className="ed-pending">
            {pending.map((entry) => (
              <li key={entry.id}>{entry.message}</li>
            ))}
          </ul>
        </>
      }
      confirmLabel={t('editor.pending.discard')}
      cancelLabel={t('editor.pending.stay')}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
