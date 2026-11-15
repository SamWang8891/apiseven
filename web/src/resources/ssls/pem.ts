// What a certificate or private-key field takes as it is typed: PEM text with the right label, or a
// $secret:// / $env:// reference (APISIX resolves those at runtime). This is entry-time guidance
// (addendum rule 10): APISIX itself parses the text with OpenSSL on save, and its verdict is shown as
// it is. Text without any PEM label is refused here, as it can only be a mistake.
import { t } from '../../i18n';
import { hostProblem } from '../routes/validate';
import { isSecretRef } from './validate';

const CERT_LABEL = /-----BEGIN CERTIFICATE-----/;
const KEY_LABEL = /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/;
const ENCRYPTED_KEY = /-----BEGIN ENCRYPTED PRIVATE KEY-----/;

/** Why `text` can't be a certificate as typed, or undefined (also for nothing typed). */
export function certProblem(text: string): string | undefined {
  if (text.trim() === '' || isSecretRef(text.trim()) || CERT_LABEL.test(text)) return undefined;
  return KEY_LABEL.test(text) || ENCRYPTED_KEY.test(text) ? t('ssl.pem.isKey') : t('ssl.pem.noCertLabel');
}

/**
 * Why `text` can't be a private key as typed, or undefined (also for nothing typed). An encrypted key
 * is refused: APISIX parses the key without a passphrase (ngx.ssl parse_pem_priv_key, ssl.lua 126).
 */
export function keyProblem(text: string): string | undefined {
  if (text.trim() === '' || isSecretRef(text.trim())) return undefined;
  if (ENCRYPTED_KEY.test(text)) return t('ssl.pem.encrypted');
  if (KEY_LABEL.test(text)) return undefined;
  return CERT_LABEL.test(text) ? t('ssl.pem.isCert') : t('ssl.pem.noKeyLabel');
}

/**
 * Why a typed SNI is refused: the schema's pattern (host_def_pat), or a wildcard that is not `*.`
 * followed by a name. The router takes "*foo.test" as covering "foo.test" and "xfoo.test" (a prefix
 * of the reversed name), which is never what is meant; "*" alone is taken.
 */
export function sniProblem(sni: string): string | undefined {
  const pattern = hostProblem(sni);
  if (pattern) return pattern;
  return sni.startsWith('*') && sni !== '*' && !sni.startsWith('*.') ? t('ssl.sni.wildcard') : undefined;
}
