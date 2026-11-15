// What a copy of a consumer or credential left out, and which lookup fields it still shares with the
// original, at the top of the copy's editor on every tab until Create or Discard: a copy made while
// the plugin list failed can drop a plugin whole, which must not go unseen. For a copy of an SSL: the
// keys it lacks and the SNIs it still shares with the original (one certificate is presented per SNI).
// For a copy of a secret manager entry: the credentials it kept (masked), which point it at the same
// account. For a copy of a global rule: the plugins APISIX will refuse while the original holds them.
import { Copy } from 'lucide-react';
import type { RemovedSecret } from '../plugins/auth';
import { t } from '../i18n';

/** A copy's notes, fixed with the draft they were made with (EditorFrame). */
export interface CopyNotes {
  /** What withoutSignInSecrets left out of the copy's plugins. */
  removed: RemovedSecret[];
  /** The lookup fields (SIGN_IN_FIELD) the copy still has from the original. */
  shared: { plugin: string; field: string }[];
  /**
   * A copy of an SSL: how many extra keys it lacks besides the main one (APISIX never returns a key),
   * the SNIs it still shares with an original APISIX presents, and whether a private key stored inside
   * the original's certificate texts was left out.
   */
  ssl?: { extraKeys: number; snis: string[]; keyInCert: boolean };
  /**
   * A copy of a secret manager entry: the credentials it kept from `from` (masked, not left out); its
   * manager, and whether APISIX has it (else which settings are credentials is not known).
   */
  credentials?: { from: string; fields: string[]; manager: string; known: boolean };
  /** A copy of a global rule: the plugins the original still holds, which APISIX refuses in a second rule. */
  globalRule?: { from: string; plugins: string[] };
}

/** What the copy of a secret manager entry kept. */
function credentialsNote({ from, fields, manager, known }: NonNullable<CopyNotes['credentials']>): string {
  if (!known) return t('editor.copyNotice.unknownManager', { from, manager });
  return fields.length > 0 ? t('editor.copyNotice.credentials', { from, fields: fields.join(', ') }) : t('editor.copyNotice.credentialsElsewhere', { from });
}

/** The secret fields left out, plugin by plugin ("basic-auth password, jwe-decrypt key and secret"). */
const secrets = (removed: RemovedSecret[]): string[] =>
  removed.flatMap((r) => ('fields' in r ? [t('editor.copyNotice.secretItem', { plugin: r.plugin, fields: r.fields.join(' and ') })] : []));

/** The plugins left out whole, each with why. */
const whole = (removed: RemovedSecret[]): string[] => removed.flatMap((r) => ('why' in r ? [t(`editor.copyNotice.${r.why}`, { plugin: r.plugin })] : []));

/** Nothing when the copy left nothing out and shares no lookup field. */
export function CopyNotice({ notes }: { notes: CopyNotes }) {
  const { ssl, credentials, globalRule } = notes;
  if (notes.removed.length === 0 && notes.shared.length === 0 && !ssl && !credentials && !globalRule) return null;
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
        {ssl && <p>{ssl.extraKeys > 0 ? t('editor.copyNotice.sslKeys', { count: ssl.extraKeys }) : t('editor.copyNotice.sslKey')}</p>}
        {ssl && ssl.snis.length > 0 && <p>{t('editor.copyNotice.sslSnis', { list: ssl.snis.join(', ') })}</p>}
        {ssl?.keyInCert && <p>{t('editor.copyNotice.sslKeyInCert')}</p>}
        {credentials && <p>{credentialsNote(credentials)}</p>}
        {globalRule && <p>{t('editor.copyNotice.globalRule', { from: globalRule.from, list: globalRule.plugins.join(', ') })}</p>}
      </div>
    </section>
  );
}
