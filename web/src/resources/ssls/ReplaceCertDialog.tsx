// The dialog that takes a certificate and its private key: to replace the main pair, to add an extra
// pair, or (`key`) to enter the key of an extra certificate again. Paste, upload or drop each. The
// certificate's details show as soon as our reader can read it (a certificate it can't read is still
// taken: APISIX parses it on save); text with no PEM label is refused as it is typed. Apply hands
// over both texts; nothing of the dialog reaches the draft before that, and it is mounted only while
// open, so every opening starts empty. APISIX doesn't check that a key belongs to its certificate
// (ssl.lua 131), and the dialog says so.
import type { ReactNode } from 'react';
import { t } from '../../i18n';
import { Button, Dialog, useEditingState } from '../../ui';
import { ExpiryBadge } from '../expiry';
import { CertDetails, Row } from './CertDetails';
import { parseCert } from './parseCert';
import { certProblem, keyProblem } from './pem';
import { PemInput } from './PemInput';
import { isSecretRef } from './validate';

export type PairMode = 'replace' | 'add' | 'key';

export interface ReplaceCertDialogProps {
  mode: PairMode;
  /** replace: the certificate now (for what changes); key: the certificate whose key is entered. */
  current?: string;
  onClose: () => void;
  onApply: (pair: { cert: string; key: string }) => void;
}

const TEXTS: Record<PairMode, { title: string; apply: string }> = {
  replace: { title: 'ssl.replace.title', apply: 'ssl.replace.apply' },
  add: { title: 'ssl.addPair.title', apply: 'ssl.addPair.apply' },
  key: { title: 'ssl.enterKey.title', apply: 'ssl.enterKey.apply' },
};

/** What the new certificate's details look like while it is typed: none yet, refused (the field says why), or its details. */
function NewCert({ text }: { text: string }) {
  if (text.trim() === '' || certProblem(text) !== undefined) return null;
  return <CertDetails pem={text} />;
}

/** The SANs of a certificate as a mono list, or a dash. */
function Names({ pem }: { pem: string | undefined }) {
  const sans = pem === undefined || isSecretRef(pem) ? undefined : parseCert(pem)?.sans;
  if (!sans || sans.length === 0) return <span>{t('ui.empty')}</span>;
  return (
    <ul className="ssl-names">
      {sans.map((name, i) => (
        <li key={i} className="mono">
          {name}
        </li>
      ))}
    </ul>
  );
}

/** Before and after a replacement: expiry and names, when both certificates can be read. */
function Compare({ before, after }: { before: string | undefined; after: string }) {
  const old = before === undefined || isSecretRef(before) ? undefined : parseCert(before);
  const next = isSecretRef(after) ? undefined : parseCert(after);
  if (!old || !next) return null;
  const cell = (children: ReactNode) => <div className="ssl-compare__cell">{children}</div>;
  return (
    <section className="ssl-compare" aria-label={t('ssl.pair.compare')}>
      <h3 className="ssl-compare__title">{t('ssl.pair.compare')}</h3>
      <dl className="ssl-dl">
        <Row term={t('ssl.pair.expires')}>
          <span className="ssl-compare__pair">
            {cell(<>{t('ssl.pair.before')}: <ExpiryBadge notAfter={old.notAfter} /></>)}
            {cell(<>{t('ssl.pair.after')}: <ExpiryBadge notAfter={next.notAfter} /></>)}
          </span>
        </Row>
        <Row term={t('ssl.cert.sans')}>
          <span className="ssl-compare__pair">
            {cell(<>{t('ssl.pair.before')}: <Names pem={before} /></>)}
            {cell(<>{t('ssl.pair.after')}: <Names pem={after} /></>)}
          </span>
        </Row>
      </dl>
    </section>
  );
}

export function ReplaceCertDialog({ mode, current, onClose, onApply }: ReplaceCertDialogProps) {
  // Editing state: what is typed here belongs to this opening (the dialog is mounted only while
  // open) and to this editing session.
  const [cert, setCert] = useEditingState(mode === 'key' ? (current ?? '') : '');
  const [key, setKey] = useEditingState('');
  const texts = TEXTS[mode];
  const ready = cert.trim() !== '' && key.trim() !== '' && certProblem(cert) === undefined && keyProblem(key) === undefined;
  return (
    <Dialog
      open
      onClose={onClose}
      title={t(texts.title)}
      size="lg"
      footer={(held) => (
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button
            variant="primary"
            disabled={!ready || held.length > 0}
            onClick={() => {
              onApply({ cert, key });
              onClose();
            }}
          >
            {t(texts.apply)}
          </Button>
        </>
      )}
    >
      <div className="ssl-dialog">
        {mode === 'key' ? (
          <CertDetails pem={current} />
        ) : (
          <>
            <PemInput label={t('ssl.pem.cert')} help={t('ssl.pem.certHelp')} value={cert} problem={certProblem(cert)} onChange={setCert} />
            <NewCert text={cert} />
          </>
        )}
        {mode === 'replace' && <Compare before={current} after={cert} />}
        <PemInput label={t('ssl.pem.key')} help={t('ssl.pem.keyHelp')} value={key} problem={keyProblem(key)} onChange={setKey} />
        <p className="ed-note">{t('ssl.pair.unchecked')}</p>
      </div>
    </Dialog>
  );
}
