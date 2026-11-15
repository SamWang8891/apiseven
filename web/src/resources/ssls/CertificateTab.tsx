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
import { ExtraPairs } from './ExtraPairs';
import { certProblem } from './pem';
import { CertBox, KeyBox } from './PemBoxes';
import { ReplaceCertDialog } from './ReplaceCertDialog';
import { typeOf } from './usage';

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/**
 * A new SSL's certificate, as typed: emitted when it can be taken (a cleared box removes it); text with
 * no PEM label, or with a private key, holds Save. A draft certificate that holds a private key (typed
 * into the JSON tab) is never put in the box: it starts empty and says that certificate stays.
 */
function CertField({ draft, setDraft, error }: { draft: TabProps['draft']; setDraft: TabProps['setDraft']; error?: string }) {
  const keyInside = holdsPrivateKey(draft.cert);
  // Editing state: the text being typed (the draft keeps the last text that could be taken).
  const [text, setText] = useEditingState(keyInside ? '' : (str(draft.cert) ?? ''));
  return (
    <>
      {keyInside && text === '' && (
        <p className="ssl-warn" role="note">
          {t('ssl.cert.draftHoldsKey')}
        </p>
      )}
      <CertBox
        label={t('ssl.pem.cert')}
        help={t('ssl.pem.certHelp')}
        value={text}
        standing={keyInside ? undefined : str(draft.cert)}
        error={error}
        onChange={(next) => {
          setText(next);
          if (next.trim() === '') setDraft(setPath(draft, ['cert'], undefined));
          else if (certProblem(next) === undefined) setDraft(setPath(draft, ['cert'], next));
        }}
      />
      {certProblem(text) === undefined && text.trim() !== '' && <CertDetails pem={text} />}
    </>
  );
}

export function CertificateTab({ draft, setDraft, isNew, issues, original }: TabProps) {
  const locked = useLocked();
  // Editing state: the Replace dialog is open (it ends with the editing session).
  const [replacing, setReplacing] = useEditingState(false);
  const certs = Array.isArray(draft.certs) ? draft.certs : [];
  const client = typeOf(draft) === 'client';
  const keyError = issueAt(issues, 'key');
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
              onChange={(key) => setDraft(key === undefined ? setPath(draft, ['key'], undefined) : { ...draft, key })}
            />
            <p className="ed-note">{t('ssl.pair.unchecked')}</p>
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
