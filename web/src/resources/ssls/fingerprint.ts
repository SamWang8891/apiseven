// SHA-256 fingerprints of certificates (parseCert's fingerprintSha256, which is async), remembered
// per PEM: once known, a certificate shows its fingerprint at once, with no update after it renders.
import { fingerprintSha256 } from './parseCert';

const SIZE = 200;
const known = new Map<string, string | undefined>();

/** The fingerprint of `pem`, computed once; undefined where the browser can't compute one (outside a secure context). */
export function fingerprintOf(pem: string): Promise<string | undefined> {
  if (known.has(pem)) return Promise.resolve(known.get(pem));
  return fingerprintSha256(pem).then((value) => {
    if (known.size >= SIZE) known.delete(known.keys().next().value as string);
    known.set(pem, value);
    return value;
  });
}

/** What fingerprintOf found for `pem` (`value` undefined: there is none), or undefined before it is computed. */
export function knownFingerprint(pem: string): { value: string | undefined } | undefined {
  return known.has(pem) ? { value: known.get(pem) } : undefined;
}
