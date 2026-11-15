// The rule every PEM box follows (the certificate and CA boxes, the private-key boxes), as pure
// functions the boxes (PemBoxes.tsx) call. The *text* is what a box shows; the *value* is what the
// field holds (the draft's, or a dialog's result).
//  1. Only the user changes the text (typing, pasting, dropping text, an accepted file). The one
//     exception: when a box is left, each private-key block in text that was not taken becomes a
//     marker line (afterLeaving), so no key rests on the page. A whole key taken in a key box closes it.
//  2. Text that was not taken is held while it is in the box (heldWhy: the box holds Save, names the
//     field, turns a dialog's primary action off). Leaving never ends a hold; only an acceptable text
//     (taken) or an empty box does.
//  3. While held, the value is what it was before the hold began (valueAfter), and the box says what is
//     kept (kept).
//  4. An empty certificate box: no value; over a value it cannot show (one that holds a private key),
//     that value. An empty key box: the key that stood (or none). The box says which (kept).
//  5. A file is judged before anything changes (fileRefusal); a refused one changes nothing, and its
//     reason shows (first) until the box next changes (PemInput).
//  6. A key box takes exactly one private-key block, or a reference (takes).
//  7. Dropped plain text is a paste, not a file (PemInput).
//  8. The messages never contradict each other: why the text is held, and what is kept meanwhile.
import { t } from '../../i18n';
import { holdsPrivateKey, MASK, withoutPrivateKeys } from '../../schema/secrets';
import { certProblem, keyProblem } from './pem';
import { isSecretRef } from './validate';

export type BoxKind = 'cert' | 'key';

/** Exactly one private-key block of a form APISIX parses (PKCS#8, PKCS#1 RSA, SEC1 EC, DSA), and nothing else. */
const ONE_KEY = /^-----BEGIN ((?:RSA |EC |DSA )?)PRIVATE KEY-----[^-]*-----END \1PRIVATE KEY-----$/;
const KEY_END = /-----END [A-Z0-9 ]*PRIVATE KEY-----/;

/** Why `text` is not taken by a box of this kind (rules 2, 6), or undefined: taken, or empty. */
export function heldWhy(kind: BoxKind, text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  if (text.includes(MASK.slice(0, 1))) return t(kind === 'cert' ? 'ssl.pem.markerCert' : 'ssl.pem.markerKey');
  if (kind === 'cert') return holdsPrivateKey(text) ? t('ssl.pem.hasKey') : certProblem(text);
  if (isSecretRef(trimmed)) return undefined;
  const problem = keyProblem(text);
  if (problem !== undefined) return problem;
  if (ONE_KEY.test(trimmed)) return undefined;
  return KEY_END.test(text) ? t('ssl.pem.notOneKey') : t('ssl.pem.incomplete');
}

/** Whether a box of this kind takes `text` as the field's value. */
export const takes = (kind: BoxKind, text: string): boolean => text.trim() !== '' && heldWhy(kind, text) === undefined;

/**
 * The value after the text changes to `text` (rules 3, 4): the text when it is taken; for an empty
 * box, none (a certificate box) or what stood (a key box), unless the box stands over a value it
 * cannot show (`hidden`), which an empty certificate box keeps; while held, `held` (what it was
 * before the hold began).
 */
export function valueAfter(kind: BoxKind, text: string, a: { held: string | undefined; stood: string | undefined; hidden: string | undefined }): string | undefined {
  if (takes(kind, text)) return text;
  if (text.trim() === '') return kind === 'key' ? a.stood : a.hidden;
  return a.held;
}

/** The text after the box is left (rule 1): private-key blocks in text that was not taken become a marker line. */
export function afterLeaving(kind: BoxKind, text: string): string {
  return takes(kind, text) ? text : withoutPrivateKeys(text, t('ssl.pem.marker'));
}

/** Why a file's text is refused by a box of this kind (rule 5), or undefined: it is put in the box (a certificate) or taken (a key). */
export function fileRefusal(kind: BoxKind, text: string): string | undefined {
  if (kind === 'cert' && holdsPrivateKey(text)) return t('ssl.pem.fileHasKey');
  const why = text.trim() === '' ? t(kind === 'cert' ? 'ssl.pem.noCertLabel' : 'ssl.pem.noKeyLabel') : heldWhy(kind, text);
  return why === undefined ? undefined : t('ssl.pem.fileRefused', { problem: why });
}

/**
 * What the box says the field keeps (rules 3, 4, 8), or nothing: while held, the value kept; for an
 * empty box, what an empty box means here.
 */
export function kept(kind: BoxKind, text: string, a: { value: string | undefined; hidden: string | undefined }): string | undefined {
  const held = heldWhy(kind, text) !== undefined;
  const empty = text.trim() === '';
  if (kind === 'key') return held || empty ? t(a.value === undefined ? 'ssl.key.none' : 'ssl.key.stays') : undefined;
  if (a.hidden !== undefined && a.value === a.hidden && (held || empty)) return t('ssl.box.hiddenStays');
  if (!held) return undefined;
  return t(a.value === undefined ? 'ssl.box.keptNone' : 'ssl.box.keptCert');
}
