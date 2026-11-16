// SHA-256 fingerprints of certificates (parseCert's fingerprintSha256, which is async), remembered
// per certificate block: once known, a certificate shows its fingerprint at once, with no update after
// it renders. Keyed by the block alone (certBlockOf), never by the whole text, which may also hold a
// private key (final wave M3).
import { certBlockOf, fingerprintSha256 } from './parseCert';

const SIZE = 200;
const known = new Map<string, string | undefined>();

/** The fingerprint of `pem`, computed once; undefined where the browser can't compute one (outside a secure context), or without a certificate block. */
export function fingerprintOf(pem: string): Promise<string | undefined> {
  const block = certBlockOf(pem);
  if (block === undefined) return Promise.resolve(undefined);
  if (known.has(block)) return Promise.resolve(known.get(block));
  return fingerprintSha256(pem).then((value) => {
    if (known.size >= SIZE) known.delete(known.keys().next().value as string);
    known.set(block, value);
    return value;
  });
}

/** What fingerprintOf found for `pem` (`value` undefined: there is none), or undefined before it is computed. */
export function knownFingerprint(pem: string): { value: string | undefined } | undefined {
  const block = certBlockOf(pem);
  if (block === undefined) return { value: undefined };
  return known.has(block) ? { value: known.get(block) } : undefined;
}
