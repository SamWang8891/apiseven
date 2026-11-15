// What a copy of a consumer or credential left out, and which lookup fields it still shares with the
// original, at the top of the copy's editor on every tab until Create or Discard: a copy made while
// the plugin list failed can drop a plugin whole, which must not go unseen.
import { Copy } from 'lucide-react';
import type { RemovedSecret } from '../plugins/auth';
import { t } from '../i18n';

/** A copy's notes, fixed with the draft they were made with (EditorFrame). */
export interface CopyNotes {
  /** What withoutSignInSecrets left out of the copy's plugins. */
  removed: RemovedSecret[];
  /** The lookup fields (SIGN_IN_FIELD) the copy still has from the original. */
  shared: { plugin: string; field: string }[];
}

/** The secret fields left out, plugin by plugin ("basic-auth password, jwe-decrypt key and secret"). */
const secrets = (removed: RemovedSecret[]): string[] =>
  removed.flatMap((r) => ('fields' in r ? [t('editor.copyNotice.secretItem', { plugin: r.plugin, fields: r.fields.join(' and ') })] : []));

/** The plugins left out whole, each with why. */
const whole = (removed: RemovedSecret[]): string[] => removed.flatMap((r) => ('why' in r ? [t(`editor.copyNotice.${r.why}`, { plugin: r.plugin })] : []));

/** Nothing when the copy left nothing out and shares no lookup field. */
export function CopyNotice({ notes }: { notes: CopyNotes }) {
  if (notes.removed.length === 0 && notes.shared.length === 0) return null;
  const fields = secrets(notes.removed);
  const plugins = whole(notes.removed);
  return (
    <section className="ed-copynote" role="note" aria-label={t('editor.copyNotice.title')}>
      <Copy size={16} aria-hidden="true" />
      <div className="ed-copynote__text">
        <p className="ed-copynote__title">{t('editor.copyNotice.title')}</p>
        {fields.length > 0 && <p>{t('editor.copyNotice.secrets', { list: fields.join(', ') })}</p>}
        {plugins.length > 0 && <p>{t('editor.copyNotice.whole', { list: plugins.join('; ') })}</p>}
        {notes.shared.length > 0 && <p>{t('editor.copyNotice.shared', { list: notes.shared.map((s) => t('editor.copyNotice.sharedItem', s)).join(', ') })}</p>}
      </div>
    </section>
  );
}
