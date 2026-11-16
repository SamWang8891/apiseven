// A certificate's details as our reader finds them (parseCert): subject, issuer, names, validity with
// the expiry badge, serial and SHA-256 fingerprint. A $secret:// or $env:// reference is shown as
// what it is, never with a private key stored after it, and a certificate the reader can't read says
// so: APISIX, which parses it with OpenSSL, is the judge of that on save.
import { useEffect, useId, useState, type ReactNode } from 'react';
import { t } from '../../i18n';
import { MASK, withoutPrivateKeys } from '../../schema/secrets';
import { formatAbsolute } from '../../table/format';
import { ExpiryBadge } from '../expiry';
import { fingerprintOf, knownFingerprint } from './fingerprint';
import { parseCert } from './parseCert';
import { isSecretRef } from './validate';

/** One term and its value: the value is named by the term (role definition, aria-labelledby). */
export function Row({ term, children }: { term: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="ssl-dl__row">
      <dt id={id} className="ssl-dl__term">
        {term}
      </dt>
      <dd aria-labelledby={id} className="ssl-dl__value">
        {children}
      </dd>
    </div>
  );
}

/** The fingerprint of `pem` once computed (`value` undefined: there is none), else undefined. */
function useFingerprint(pem: string): { value: string | undefined } | undefined {
  // View state: a render once the fingerprint is known (it lives in fingerprint.ts, not here).
  const [, setReady] = useState(0);
  const found = knownFingerprint(pem);
  useEffect(() => {
    if (knownFingerprint(pem)) return;
    let live = true;
    void fingerprintOf(pem).then(() => live && setReady((n) => n + 1));
    return () => {
      live = false;
    };
  }, [pem]);
  return found;
}

/** The browser computes a digest only in a secure context (HTTPS or localhost): without one there is no crypto.subtle. */
const canDigest = (): boolean => globalThis.crypto?.subtle !== undefined;

function Fingerprint({ pem }: { pem: string }) {
  const found = useFingerprint(pem);
  if (!found) return <span className="ssl-muted">{t('ssl.cert.computing')}</span>;
  if (found.value === undefined && !canDigest()) return <span className="ssl-muted">{t('ssl.cert.fingerprintInsecure')}</span>;
  return <span className="mono ssl-wrap">{found.value ?? t('ui.empty')}</span>;
}

/**
 * A certificate text that is a reference, as shown: trimmed, with every private-key block in it
 * masked. APISIX takes a text that starts with a reference as one and parses nothing after it
 * (secret.lua 91–103, ssl.lua 192–199), so a key pasted after the reference is stored with it; it
 * never reaches the page (final wave M2).
 */
// eslint-disable-next-line react-refresh/only-export-components -- what a reference shows as, beside the component that shows it
export const referenceText = (pem: string): string => withoutPrivateKeys(pem.trim(), MASK);

/** Details of the first certificate in `pem`; a note for a reference, one that can't be read, or none. */
export function CertDetails({ pem }: { pem: unknown }) {
  if (typeof pem !== 'string' || pem.trim() === '') return <p className="ed-note">{t('ssl.cert.none')}</p>;
  if (isSecretRef(pem.trim())) {
    return (
      <dl className="ssl-dl">
        <Row term={t('ssl.cert.reference')}>
          <span className="mono ssl-wrap">{referenceText(pem)}</span>
          <span className="ssl-muted"> {t('ssl.cert.ref')}</span>
        </Row>
      </dl>
    );
  }
  const info = parseCert(pem);
  if (!info) {
    return (
      <p className="ssl-warn" role="note">
        {t('ssl.cert.unreadable')}
      </p>
    );
  }
  return (
    <dl className="ssl-dl">
      <Row term={t('ssl.cert.subject')}>{info.subject}</Row>
      <Row term={t('ssl.cert.issuer')}>{info.issuer}</Row>
      <Row term={t('ssl.cert.sans')}>
        {info.sans.length === 0 ? (
          t('ssl.cert.noSans')
        ) : (
          <ul className="ssl-names">
            {info.sans.map((name, i) => (
              <li key={i} className="mono">
                {name}
              </li>
            ))}
          </ul>
        )}
      </Row>
      <Row term={t('ssl.cert.notBefore')}>{formatAbsolute(info.notBefore / 1000)}</Row>
      <Row term={t('ssl.cert.notAfter')}>
        <span className="ssl-expiry">
          {formatAbsolute(info.notAfter / 1000)} <ExpiryBadge notAfter={info.notAfter} />
        </span>
      </Row>
      <Row term={t('ssl.cert.serial')}>
        <span className="mono ssl-wrap">{info.serial}</span>
      </Row>
      <Row term={t('ssl.cert.fingerprint')}>
        <Fingerprint pem={pem} />
      </Row>
    </dl>
  );
}
