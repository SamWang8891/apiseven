// The rule every PEM box follows (the certificate and CA boxes, the private-key boxes), as pure
// functions the boxes (PemBoxes.tsx) call. The *text* is what a box shows; the *value* is what the
// field holds (the draft's, or a dialog's result).
//  1. Only the user changes the text (typing, pasting, dropping text, an accepted file). Every path
//     that sets it, the initial text included, goes through one function (`shown`): while the box
//     has focus the text is shown as given; otherwise each private-key block in text that was not
//     taken is a marker line at once (keyBlocks), and when the box loses focus the same happens. So
//     no key rests on the page outside the focused box, whether or not a focus event ever arrives (a
//     drop gives none). Nothing else changes the text; a whole key taken in a key box closes it.
//  2. Text that was not taken is held while it is in the box (heldWhy: the box holds Save, names the
//     field, turns a dialog's primary action off). Leaving never ends a hold; only an acceptable text
//     (taken) or an empty box does.
//  3. While held, the value is what it was before the hold began (valueAfter), and the box says what is
//     kept (kept).
//  4. An empty certificate box: no value; over a value it cannot show (one that holds a private key),
//     that value. An empty key box: the key that stood (or none). The box says which (kept).
//  5. A file is judged before anything changes (fileRefusal); a refused one changes nothing, and its
//     reason shows (first) until the box next changes (PemInput).
//  6. A key box takes text with exactly one private-key block and no certificate block, unencrypted,
//     starting with "---" as APISIX needs; what OpenSSL skips may come with it (an EC PARAMETERS
//     block, lines after the key). A reference is taken, in any box, only as the whole text (takes).
//  7. Dropped text is a paste, not a file; a drop with neither changes nothing (PemInput).
//  8. The messages never contradict each other: why the text is held, and what is kept meanwhile.
//  9. A box never opens or closes because focus moved (PemBoxes: Keep the entered key).
import { t } from '../../i18n';
import { holdsPrivateKey, MASK } from '../../schema/secrets';
import { certProblem, keyProblem } from './pem';

export type BoxKind = 'cert' | 'key';

/**
 * Text that starts like a reference: "$secret://", or "$env://" in any case (APISIX's
 * check_secret_uri, apisix/secret.lua 91–100: a prefix test, so anything after it skips the PEM
 * checks, ssl.lua 192–199).
 */
const LIKE_REF = /^(?:\$secret:\/\/|\$[Ee][Nn][Vv]:\/\/)/;
/** One whole reference: nothing after it, no white space inside. */
const REF = /^(?:\$secret:\/\/|\$[Ee][Nn][Vv]:\/\/)\S+$/;

/** Whether `text` (trimmed) is one whole $secret:// or $env:// reference and nothing else (rule 6). */
export const isReference = (text: string): boolean => REF.test(text.trim());

const KEY_BEGIN = /-----BEGIN ([A-Z0-9 ]*)PRIVATE KEY-----/g;
/** A certificate block of any label (CERTIFICATE, TRUSTED CERTIFICATE, CERTIFICATE REQUEST). */
const CERT_BLOCK = /-----BEGIN [A-Z0-9 ]*CERTIFICATE[A-Z0-9 ]*-----/;
/** The labels APISIX's OpenSSL reads a key under (PKCS#8, PKCS#1 RSA, SEC1 EC, DSA). */
const KEY_LABELS = new Set(['', 'RSA ', 'EC ', 'DSA ']);

interface KeyBlock {
  start: number;
  end: number;
  label: string;
  /** It ends with its own END line. */
  whole: boolean;
}

/**
 * The private-key blocks of `text` (rule 1): each from a "-----BEGIN … PRIVATE KEY-----" line to its
 * own END line; without one before the next line that starts "-----BEGIN ", up to (not including)
 * that line, or to the end of the text.
 */
function keyBlocks(text: string): KeyBlock[] {
  const blocks: KeyBlock[] = [];
  for (const match of text.matchAll(KEY_BEGIN)) {
    const start = match.index;
    if (start < (blocks.at(-1)?.end ?? 0)) continue;
    const label = match[1] ?? '';
    const from = start + match[0].length;
    const next = text.indexOf('\n-----BEGIN ', from);
    const endTag = `-----END ${label}PRIVATE KEY-----`;
    const end = text.indexOf(endTag, from);
    if (end !== -1 && (next === -1 || end < next)) blocks.push({ start, end: end + endTag.length, label, whole: true });
    else blocks.push({ start, end: next === -1 ? text.length : next, label, whole: false });
  }
  return blocks;
}

/** `text` with each private-key block a marker line; the rest as it was. */
function masked(text: string): string {
  let out = '';
  let at = 0;
  for (const block of keyBlocks(text)) {
    out += text.slice(at, block.start) + t('ssl.pem.marker');
    at = block.end;
  }
  return out + text.slice(at);
}

/** Why a key box does not take `text` (rule 6), past the checks shared with every text. */
function keyWhy(text: string): string | undefined {
  const problem = keyProblem(text);
  if (problem !== undefined) return problem;
  const blocks = keyBlocks(text);
  const [block] = blocks;
  if (blocks.length > 1 || CERT_BLOCK.test(text)) return t('ssl.pem.notOneKey');
  if (block === undefined || !KEY_LABELS.has(block.label)) return t('ssl.pem.noKeyLabel');
  if (!block.whole) return t('ssl.pem.incomplete');
  // APISIX encrypts a key, and decrypts it before parsing, by whether its text starts with "---"
  // (ssl.lua 89–104): anything before the first BEGIN line makes it refuse the key.
  return text.startsWith('---') ? undefined : t('ssl.pem.keyNotFirst');
}

/** Why `text` is not taken by a box of this kind (rules 2, 6), or undefined: taken, or empty. */
export function heldWhy(kind: BoxKind, text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  if (text.includes(MASK.slice(0, 1))) return t(kind === 'cert' ? 'ssl.pem.markerCert' : 'ssl.pem.markerKey');
  if (kind === 'cert' && holdsPrivateKey(text)) return t('ssl.pem.hasKey');
  if (LIKE_REF.test(trimmed)) return REF.test(trimmed) ? undefined : t('ssl.pem.refNotAlone');
  return kind === 'cert' ? certProblem(text) : keyWhy(text);
}

/** Whether a box of this kind takes `text` as the field's value. */
export const takes = (kind: BoxKind, text: string): boolean => text.trim() !== '' && heldWhy(kind, text) === undefined;

/**
 * What a box shows when its text becomes `text` (rule 1): the text itself while the box has focus,
 * or when it is taken; otherwise its private-key blocks are marker lines. Every way of setting a
 * box's text goes through here, losing focus included (`focused` false).
 */
export const shown = (kind: BoxKind, text: string, focused: boolean): string => (focused || takes(kind, text) ? text : masked(text));

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
