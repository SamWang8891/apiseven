// The SSL editor's Certificate tab (fields cert, key, certs, keys). A stored SSL shows its
// certificate's details and "Private key: stored in APISIX, not shown" (a GET never returns it);
// Replace certificate (editing only) takes a new pair through ReplaceCertDialog and puts both in the
// draft; the save is a PATCH of the pair (editor/save.ts), which keeps the stored extra keys. A new
// SSL takes the pair here, inline. A private key is never shown once taken: not here (KeyBox), not
// in the JSON tab (a note stands for it), and after a save the draft holds none again (the item is
// read back with GET). A stored certificate whose text also holds a key says so. Additional pairs:
// ExtraPairs.
import { setPath } from '../../editor/draft';
import { issueAt } from '../../editor/issues';
import { t } from '../../i18n';
import { holdsPrivateKey } from '../../schema/secrets';
import { Button, useEditingState, useLocked } from '../../ui';
import type { TabProps } from '../registry';
import { CertDetails, Row } from './CertDetails';
import { useKeyVerdict } from './keyMatch';
import { KeyMatchLine } from './KeyMatchLine';
import { ExtraPairs } from './ExtraPairs';
import { CertBox, KeyBox } from './PemBoxes';
import { ReplaceCertDialog } from './ReplaceCertDialog';
import { typeOf } from './usage';

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/**
 * A new SSL's certificate: a CertBox over the draft's `cert` (the rule in pemBox.ts). A draft
 * certificate that holds a private key (typed into the JSON tab) is one the box cannot show: it is
 * fixed for this editing session, and an empty box keeps it.
 */
function CertField({ draft, setDraft, error }: { draft: TabProps['draft']; setDraft: TabProps['setDraft']; error?: string }) {
  // Editing state: the draft certificate the box cannot show, as it was when editing began.
  const [hidden] = useEditingState(() => (holdsPrivateKey(draft.cert) ? str(draft.cert) : undefined));
  return (
    <CertBox
      label={t('ssl.pem.cert')}
      help={t('ssl.pem.certHelp')}
      value={str(draft.cert)}
      hidden={hidden}
      details
      error={error}
      onValue={(cert) => setDraft(setPath(draft, ['cert'], cert))}
    />
  );
}

export function CertificateTab({ draft, setDraft, isNew, issues, original }: TabProps) {
  const locked = useLocked();
  // Editing state: the Replace dialog is open (it ends with the editing session).
  const [replacing, setReplacing] = useEditingState(false);
  const certs = Array.isArray(draft.certs) ? draft.certs : [];
  const client = typeOf(draft) === 'client';
  const keyError = issueAt(issues, 'key');
  // Whether the pair's key (a new SSL's, or one entered with Replace) belongs to its certificate:
  // a warning at most, never a reason to refuse Create or Save.
  const verdict = useKeyVerdict(str(draft.cert), str(draft.key));
  return (
    <div className="ed-stack ssl-tab">
      <section className="ssl-main" aria-label={t('ssl.cert.region')}>
        {isNew ? (
          <>
            {draft.cert !== undefined && draft.key === undefined && <p className="ed-note">{t('ssl.key.needed')}</p>}
            <CertField draft={draft} setDraft={setDraft} error={issueAt(issues, 'cert')} />
            <KeyBox
              label={t('ssl.pem.key')}
              help={t('ssl.pem.keyHelp')}
              error={keyError}
              value={str(draft.key)}
              onValue={(key) => setDraft(key === undefined ? setPath(draft, ['key'], undefined) : { ...draft, key })}
            />
            <KeyMatchLine verdict={verdict} />
          </>
        ) : (
          <>
            {holdsPrivateKey(draft.cert) && (
              <p className="ssl-warn" role="note">
                {t('ssl.cert.holdsKey')}
              </p>
            )}
            <CertDetails pem={draft.cert} />
            {issueAt(issues, 'cert') && <p className="ssl-issue">{issueAt(issues, 'cert')}</p>}
            <dl className="ssl-dl">
              <Row term={t('ssl.key.label')}>{draft.key === undefined ? t('ssl.key.stored') : t('ssl.key.replaced')}</Row>
            </dl>
            {keyError && <p className="ssl-issue">{keyError}</p>}
            {draft.key !== undefined && verdict !== undefined && <KeyMatchLine verdict={verdict} />}
            {!locked && (
              <span>
                <Button onClick={() => setReplacing(true)}>{t('ssl.replace')}</Button>
              </span>
            )}
          </>
        )}
      </section>
      {(!client || certs.length > 0 || draft.keys !== undefined) && (
        <ExtraPairs draft={draft} setDraft={setDraft} isNew={isNew} original={original} issues={issues} client={client} />
      )}
      {replacing && !locked && (
        <ReplaceCertDialog mode="replace" current={str(draft.cert)} onClose={() => setReplacing(false)} onApply={({ cert, key }) => setDraft({ ...draft, cert, key })} />
      )}
    </div>
  );
}
