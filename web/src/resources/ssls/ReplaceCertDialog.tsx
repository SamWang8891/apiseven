// The dialog that takes a certificate and its private key: to replace the main pair, to add an extra
// pair, or (`key`) to enter the key of an extra certificate again. Paste, upload or drop each (the
// key leaves its box once taken; both boxes follow the rule in pemBox.ts, so text not taken holds
// the dialog and Apply is off; a combined PEM given to either box offers to split it between them). The certificate's details show as soon as our reader can read it (a
// certificate it can't read is still taken: APISIX parses it on save). Apply hands over both values;
// nothing of the dialog reaches the draft before that, and it is mounted only while open, so every
// opening starts empty. APISIX doesn't check that a key belongs to its certificate
// (ssl.lua 131): the dialog checks it (keyMatch.ts) and says what it found, without turning Apply off.
import type { ReactNode } from 'react';
import { t } from '../../i18n';
import { Button, Dialog, useEditingState } from '../../ui';
import { ExpiryBadge } from '../expiry';
import { CertDetails, Row } from './CertDetails';
import { parseCert } from './parseCert';
import { useKeyVerdict } from './keyMatch';
import { KeyMatchLine } from './KeyMatchLine';
import { usePairLink } from './pairLink';
import { CertBox, KeyBox } from './PemBoxes';
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
  // Editing state: the certificate and key taken so far belong to this opening (the dialog is
  // mounted only while open) and to this editing session.
  const [cert, setCert] = useEditingState<string | undefined>(mode === 'key' ? current : undefined);
  const [key, setKey] = useEditingState<string | undefined>(undefined);
  const texts = TEXTS[mode];
  const ready = cert !== undefined && key !== undefined;
  // Whether the key belongs to the certificate: a warning at most, never a reason to turn Apply off.
  const verdict = useKeyVerdict(cert, key);
  // The two boxes split a combined PEM between them; Enter key has no certificate box to give a part to.
  const link = usePairLink(key !== undefined);
  const pair = mode === 'key' ? undefined : link;
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
              if (cert !== undefined && key !== undefined) onApply({ cert, key });
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
          <CertBox label={t('ssl.pem.cert')} help={t('ssl.pem.certHelp')} value={cert} onValue={setCert} details pair={pair} />
        )}
        {mode === 'replace' && cert !== undefined && <Compare before={current} after={cert} />}
        <KeyBox label={t('ssl.pem.key')} help={t('ssl.pem.keyHelp')} value={key} onValue={setKey} pair={pair} />
        <KeyMatchLine verdict={verdict} />
      </div>
    </Dialog>
  );
}
