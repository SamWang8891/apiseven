import { t } from '../i18n';
import { ConfirmDialog } from '../ui';

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
