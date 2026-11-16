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
//  3. While held, the value is what it was before the hold began: the last value taken, a reference
//     taken in a key box included, not the key that stood when editing began (valueAfter; final wave
//     M4); and the box says what is kept (kept).
//  4. An empty certificate box: no value; over a value it cannot show (one that holds a private key),
//     that value. An empty key box: the key that stood (or none). The box says which (kept).
//  5. A file is judged before anything changes (fileRefusal); a refused one changes nothing, and its
//     reason shows (first) until the box next changes (PemInput).
//  6. A key box takes text with exactly one private-key block and no certificate block, unencrypted;
//     what OpenSSL skips may come with it (an EC PARAMETERS block, lines after the key). It takes it
//     from its first "-----BEGIN" line (takenValue), as APISIX refuses a key with anything before it,
//     and says when lines that were not white space were left out (leftOutBefore). A reference is
//     taken, in any box, only as the whole text (takes), and without the white space around it.
//  7. Dropped text is a paste, not a file; a drop with neither changes nothing (PemInput).
//  8. The messages never contradict each other: why the text is held, and what is kept meanwhile.
//  9. A box never opens or closes because focus moved (PemBoxes: Keep the entered key).
// 10. A combined text (Task 16 B23): text or a file given to either box of a pair that holds
//     certificate blocks and exactly one private-key block the key box would take (splitOf) offers
//     one action; only that action puts the certificates in the certificate box and gives the key to
//     the key box, each through its own path (so 1–9 hold for both). Not for the CA box.
import { t } from '../../i18n';
import { holdsPrivateKey, keyMaterialIn } from '../../schema/secrets';
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
  // What comes before the first BEGIN line is left out when it is taken (takenValue).
  return block.whole ? undefined : t('ssl.pem.incomplete');
}

/** Why `text` is not taken by a box of this kind (rules 2, 6), or undefined: taken, or empty. */
export function heldWhy(kind: BoxKind, text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  const material = keyMaterialIn(text);
  if (material === 'marker') return t(kind === 'cert' ? 'ssl.pem.markerCert' : 'ssl.pem.markerKey');
  if (kind === 'cert' && material === 'key') return t('ssl.pem.hasKey');
  if (LIKE_REF.test(trimmed)) return REF.test(trimmed) ? undefined : t('ssl.pem.refNotAlone');
  return kind === 'cert' ? certProblem(text) : keyWhy(text);
}

/** Whether a box of this kind takes `text` as the field's value. */
export const takes = (kind: BoxKind, text: string): boolean => text.trim() !== '' && heldWhy(kind, text) === undefined;

const FIRST_BEGIN = '-----BEGIN';

/**
 * The field's value when a box of this kind takes `text` (rule 6): a key from its first "-----BEGIN"
 * line, since APISIX encrypts a key, and decrypts it before parsing, by whether its text starts with
 * "---" (ssl.lua 89–104), so anything before that line (Bag Attributes, comments, white space) makes
 * it refuse the key; a reference without the white space around it (Task 16b, item 104: APISIX
 * stores one with white space but never resolves it, and refuses one with white space before it,
 * secret.lua 91–100 being a prefix test); a certificate as it is.
 */
export function takenValue(kind: BoxKind, text: string): string {
  if (isReference(text)) return text.trim();
  const at = text.indexOf(FIRST_BEGIN);
  return kind === 'key' && at > 0 ? text.slice(at) : text;
}

/** Whether taking `text` as a key leaves out lines before its first "-----BEGIN" line that are more than white space. */
export function leftOutBefore(text: string): boolean {
  const at = text.indexOf(FIRST_BEGIN);
  return at > 0 && text.slice(0, at).trim() !== '';
}

/** What a combined text splits into: the certificate blocks in their order, and the one key block. */
export interface SplitParts {
  certs: string;
  key: string;
}

const CERT_BLOCKS = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;

/**
 * Rule 10: a text holding certificate blocks and exactly one private-key block, whole, that a key
 * box would take: the certificates (each block as it is, in their order, one per line) and the key
 * block alone. Undefined for anything else (no certificate, two keys, a half key, an encrypted one).
 */
export function splitOf(text: string): SplitParts | undefined {
  const certs = text.match(CERT_BLOCKS) ?? [];
  const blocks = keyBlocks(text);
  const [block] = blocks;
  if (certs.length === 0 || blocks.length !== 1 || !block?.whole) return undefined;
  const key = `${text.slice(block.start, block.end)}\n`;
  return takes('key', key) ? { certs: `${certs.join('\n')}\n`, key } : undefined;
}

/**
 * What a box shows when its text becomes `text` (rule 1): the text itself while the box has focus,
 * or when it is taken; otherwise its private-key blocks are marker lines. Every way of setting a
 * box's text goes through here, losing focus included (`focused` false).
 */
export const shown = (kind: BoxKind, text: string, focused: boolean): string => (focused || takes(kind, text) ? text : masked(text));

/**
 * The value after the text changes to `text` (rules 3, 4): what it takes (takenValue); for an empty
 * box, none (a certificate box) or what stood (a key box), unless the box stands over a value it
 * cannot show (`hidden`), which an empty certificate box keeps; while held, `held` (what it was
 * before the hold began: the last value taken).
 */
export function valueAfter(kind: BoxKind, text: string, a: { held: string | undefined; stood: string | undefined; hidden: string | undefined }): string | undefined {
  if (takes(kind, text)) return takenValue(kind, text);
  if (text.trim() === '') return kind === 'key' ? a.stood : a.hidden;
  return a.held;
}

/**
 * Why a file was refused (rule 5): in full, as the box says it, and bare: what was wrong and that the
 * file was not put in the box, with no instruction, for beside a split offer, whose action is what
 * resolves it (rule 8; fix round 1, R3.1).
 */
export interface FileReason {
  full: string;
  bare: string;
}

/** The bare form of each problem a box states, by its message key. */
const BARE: [string, string][] = [
  ['ssl.pem.noCertLabel', 'ssl.pem.bare.noCertLabel'],
  ['ssl.pem.noKeyLabel', 'ssl.pem.bare.noKeyLabel'],
  ['ssl.pem.isCert', 'ssl.pem.bare.isCert'],
  ['ssl.pem.encrypted', 'ssl.pem.bare.encrypted'],
  ['ssl.pem.notOneKey', 'ssl.pem.bare.notOneKey'],
  ['ssl.pem.incomplete', 'ssl.pem.bare.incomplete'],
  ['ssl.pem.refNotAlone', 'ssl.pem.bare.refNotAlone'],
  ['ssl.pem.markerCert', 'ssl.pem.bare.marker'],
  ['ssl.pem.markerKey', 'ssl.pem.bare.marker'],
  ['ssl.pem.hasKey', 'ssl.pem.bare.hasKey'],
];
const bareOf = (problem: string): string => t(BARE.find(([key]) => t(key) === problem)?.[1] ?? 'ssl.pem.bare.other');

/** Why a file's text is refused by a box of this kind (rule 5), or undefined: it is put in the box (a certificate) or taken (a key). */
export function fileRefusal(kind: BoxKind, text: string): FileReason | undefined {
  if (kind === 'cert' && holdsPrivateKey(text)) return { full: t('ssl.pem.fileHasKey'), bare: t('ssl.pem.bare.hasKey') };
  const why = text.trim() === '' ? t(kind === 'cert' ? 'ssl.pem.noCertLabel' : 'ssl.pem.noKeyLabel') : heldWhy(kind, text);
  return why === undefined ? undefined : { full: t('ssl.pem.fileRefused', { problem: why }), bare: bareOf(why) };
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
