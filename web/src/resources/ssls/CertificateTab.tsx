// The SSL editor's Certificate tab (fields cert, key, certs, keys). A stored SSL shows its
// certificate's details and "Private key: stored in APISIX, not shown" (a GET never returns it);
// Replace certificate (editing only) takes a new pair through ReplaceCertDialog and puts both in the
// draft, so the save becomes a full PUT (editor/save.ts). A new SSL takes the pair here, inline. A
// private key is never shown once taken: not here, not in the JSON tab (a note stands for it), and
// after a save the draft holds none again (the item is read back with GET). Additional pairs:
// ExtraPairs.
import { setPath } from '../../editor/draft';
import { issueAt } from '../../editor/issues';
import { t } from '../../i18n';
import { Button, Field, useEditingState, useLocked } from '../../ui';
import { ReadOnlyValue } from '../../ui/ReadOnly';
import type { TabProps } from '../registry';
import { CertDetails, Row } from './CertDetails';
import { ExtraPairs } from './ExtraPairs';
import { certProblem, keyProblem } from './pem';
import { PemInput } from './PemInput';
import { ReplaceCertDialog } from './ReplaceCertDialog';
import { typeOf } from './usage';

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** A new SSL's certificate, as typed: emitted when it can be taken (a cleared box removes it); text with no PEM label holds Save. */
function CertField({ draft, setDraft, error }: { draft: TabProps['draft']; setDraft: TabProps['setDraft']; error?: string }) {
  // Editing state: the text being typed (the draft keeps the last text that could be taken).
  const [text, setText] = useEditingState(str(draft.cert) ?? '');
  return (
    <>
      <PemInput
        label={t('ssl.pem.cert')}
        help={t('ssl.pem.certHelp')}
        value={text}
        problem={certProblem(text)}
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

/**
 * A new SSL's private key: what is typed shows while it is typed and goes into the draft once it can
 * be taken; when the box is left the text goes, and one line reads "entered, not shown", with Replace
 * key (an empty box again; the entered key stays until another is taken, and the box says so) and
 * Remove.
 */
function KeyField({ draft, setDraft, error }: { draft: TabProps['draft']; setDraft: TabProps['setDraft']; error?: string }) {
  const locked = useLocked();
  // Editing state: the key being typed (never filled from the draft), and whether its box is open
  // over a key already entered.
  const [text, setText] = useEditingState('');
  const [replacing, setReplacing] = useEditingState(false);
  const entered = draft.key !== undefined;
  if (locked) {
    return (
      <Field label={t('ssl.pem.key')}>
        <ReadOnlyValue>{entered ? t('ssl.key.entered') : undefined}</ReadOnlyValue>
      </Field>
    );
  }
  if (entered && !replacing && text === '') {
    return (
      <Field label={t('ssl.pem.key')} error={error}>
        <span className="ssl-keyline">
          <span>{t('ssl.key.entered')}</span>
          <Button size="sm" onClick={() => setReplacing(true)}>
            {t('ssl.key.replaceKey')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDraft(setPath(draft, ['key'], undefined))}>
            {t('ssl.key.remove')}
          </Button>
        </span>
      </Field>
    );
  }
  return (
    <div className="ssl-main">
      <PemInput
        label={t('ssl.pem.key')}
        help={t('ssl.pem.keyHelp')}
        value={text}
        problem={keyProblem(text)}
        error={error}
        autoFocus={replacing}
        onChange={(next) => {
          setText(next);
          if (next.trim() !== '' && keyProblem(next) === undefined) setDraft({ ...draft, key: next });
        }}
        onBlur={() => {
          // Left with a key taken, or with nothing typed: back to the one line.
          if (text.trim() === '' || keyProblem(text) === undefined) {
            setText('');
            setReplacing(false);
          }
        }}
      />
      {entered && text === '' && <span className="ssl-muted">{t('ssl.key.entered')}</span>}
    </div>
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
            {draft.cert !== undefined && draft.key === undefined && (
              <p className="ssl-warn" role="note">
                {t('ssl.key.copyNote')}
              </p>
            )}
            <CertField draft={draft} setDraft={setDraft} error={issueAt(issues, 'cert')} />
            <KeyField draft={draft} setDraft={setDraft} error={keyError} />
            <p className="ed-note">{t('ssl.pair.unchecked')}</p>
          </>
        ) : (
          <>
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
