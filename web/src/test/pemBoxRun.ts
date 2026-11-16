// What the two PEM box property tests share (resources/ssls/pemBoxes.property.test.tsx, at tab level,
// and pemBoxes.page.property.test.tsx, through the real editor frame): the texts and files, a
// reference model of the rule (task-14 r3 "The rule for every PEM box" with the r4 amendments, and
// Task 16 B23: a key taken from its first BEGIN line, a combined PEM split between a pair's boxes),
// the actions a user takes on a box, a seeded generator of them, and the checks made after every step.
// Task 16b adds: a reference taken without its white space (item 104); the split's name telling a
// value from text a box holds (143); a refused file that offers nothing leaving the text's own offer
// (144); the other box of a pair offering the split, which this box's messages then point at (145);
// and file reads left pending across other actions, ignored when anything happened in the box since
// (147). The final wave (M4) restates rule 3: while text is held, the value is the last accepted one
// (a reference taken in a key box included), not the key that stood when editing began, which is what
// an empty key box and Keep the entered key go back to. The model states the rule on its own; it
// imports nothing from the boxes' code.
import { act, fireEvent, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { expect } from 'vitest';
import { t } from '../i18n';
import { RSA_LEAF } from './certs';
import { RSA_CA } from './certs';
import { BAG_KEY, EC_PAIR, EC_PARAMS_KEY, RSA_PAIR } from './pairs';
import { deferredFile } from './deferredFile';
import type { prng } from './prng';
import { SEED_CERT, SEED_KEY } from './sslSeed';

export type Kind = 'cert' | 'key';

// --- The rule, stated on its own ------------------------------------------------------------------

/** 1″: a private-key block runs from its BEGIN line to its own END line; without one, up to the next line that starts "-----BEGIN ", or the end. */
const KEY_BLOCK = /-----BEGIN ([A-Z0-9 ]*)PRIVATE KEY-----(?:(?!\n-----BEGIN )[\s\S])*?(?:-----END \1PRIVATE KEY-----|(?=\n-----BEGIN )|$)/g;
/** A whole key: BEGIN to its END (anything between), as invariant 1 looks for it in the markup. */
export const WHOLE_KEY = /-----BEGIN ([A-Z0-9 ]*)PRIVATE KEY-----[\s\S]*?-----END \1PRIVATE KEY-----/g;

/** 1″: every private-key block a marker line; the rest of the text as it was. */
export const masked = (text: string): string => text.replace(KEY_BLOCK, () => t('ssl.pem.marker'));

const keyMaterial = (text: string): boolean => /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(text);

/** 6″: text that starts like a reference (APISIX's check_secret_uri: "$secret://", or "$env://" in any case). */
const likeRef = (s: string): boolean => s.startsWith('$secret://') || s.slice(0, 7).toUpperCase() === '$ENV://';
/** 6″: one reference and nothing else: no white space, something after "://". */
const isRef = (s: string): boolean => likeRef(s) && !/\s/.test(s) && s.length > s.indexOf('://') + 3;

/**
 * Whether a box of this kind takes `text` (6′, 6″; a marker line is never taken). A key may have
 * anything before its first BEGIN line: it is taken from that line (`taken`, Task 16 B23).
 */
export function takes(kind: Kind, text: string): boolean {
  const s = text.trim();
  if (s === '' || text.includes('•')) return false;
  if (likeRef(s)) return isRef(s);
  if (kind === 'cert') return !keyMaterial(text) && text.includes('-----BEGIN CERTIFICATE-----');
  const blocks = text.match(KEY_BLOCK) ?? [];
  const [block] = blocks;
  return (
    blocks.length === 1 &&
    block !== undefined &&
    /^-----BEGIN ((?:RSA |EC |DSA )?)PRIVATE KEY-----[\s\S]*-----END \1PRIVATE KEY-----$/.test(block) &&
    !/Proc-Type:\s*4,ENCRYPTED/.test(block) &&
    !/-----BEGIN [A-Z0-9 ]*CERTIFICATE/.test(text)
  );
}

/**
 * The value a box takes from `text`: a reference without the white space around it (Task 16b, item
 * 104); a key from its first BEGIN line (APISIX refuses anything before it, ssl.lua 89–104); anything
 * else as it is.
 */
export function taken(kind: Kind, text: string): string {
  if (isRef(text.trim())) return text.trim();
  const at = text.indexOf('-----BEGIN');
  return kind === 'key' && at > 0 ? text.slice(at) : text;
}

/** A key taken from `text` left out lines before its BEGIN line that were more than white space (the box says so). */
const leftOutOf = (text: string): boolean => text.indexOf('-----BEGIN') > 0 && text.slice(0, text.indexOf('-----BEGIN')).trim() !== '';

/** Task 16 B23: what a combined text splits into. */
export interface Split {
  certs: string;
  key: string;
}

/**
 * A text with certificate blocks and exactly one private-key block, whole, that a key box takes:
 * the CERTIFICATE blocks in their order, one per line, and the key block alone. Else undefined.
 */
export function splitOf(text: string): Split | undefined {
  const certs = text.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
  const keys = text.match(KEY_BLOCK) ?? [];
  const key = keys[0] === undefined ? undefined : `${keys[0]}\n`;
  if (certs.length === 0 || keys.length !== 1 || key === undefined || !takes('key', key)) return undefined;
  return { certs: `${certs.join('\n')}\n`, key };
}

/** What the page should show and hold for one box (and the field behind it). */
export interface Model {
  kind: Kind;
  /** What the box shows ('' while a key box is closed). */
  text: string;
  /** The field's value (the draft's, or the dialog's). */
  value: string | undefined;
  /** A key box was opened with Replace key. */
  opened: boolean;
  /** The box's textarea is the focused element. */
  focused: boolean;
  /** A key box: the key that stood when this opening's editing began (an empty box and Keep go back to it); null before it began. */
  stood: string | undefined | null;
  /** A certificate box: the value it stands over and cannot show. */
  hidden: string | undefined;
  /** The box is one of a pair (a new SSL, the pair dialog): it offers to split a combined text. */
  pair: boolean;
  /** In a pair, the other box's value (a key for a certificate box, a certificate for a key box). */
  other: string | undefined;
  /** In a pair, the other box holds text it has not taken (the `otherText` action; fix round 2, R8): it holds Save, its value as it was. */
  otherHeld: boolean;
  /** The split this box offers now, if any, and what offered it: the box's text, or a file it refused. */
  offer: (Split & { from: 'text' | 'file' }) | undefined;
  /** In a pair, the split the other box offers (its text is a combined one: item 145); its action gives this box its part. */
  otherOffer: Split | undefined;
  /** A refused file's reason stands: until the box next changes (rule 5), or its input goes (a remount, a closed key box). */
  refused: boolean;
  /** File reads still in progress (item 147): each goes stale when anything happens in the box before it finishes. */
  pending: PendingRead[];
  /** A key box closed over a key whose lines before its BEGIN line were left out says so. */
  leftOut: boolean;
  /**
   * A CA box over a stored CA it cannot show gives way to that CA's details whenever the field holds
   * it, unless Replace CA opened it in this session (ClientTab CaField: `replacing`, a session flag of
   * the field around the box, lost on a remount): whether this box does so, and whether it is open.
   */
  closesOverHidden: boolean;
  hiddenOpen: boolean;
}

/** A file read still in progress: what it will give (undefined: unreadable), and whether it went stale. */
export interface PendingRead {
  text: string | undefined;
  stale: boolean;
}

/** Something happened in the box (a change, another file, its input gone): every read in progress is stale (item 147). */
export const staleReads = (m: Model): void => {
  for (const read of m.pending) read.stale = true;
  m.pending = [];
};

export const newModel = (kind: Kind, value: string | undefined, text: string, hidden?: string, pair?: { other: string | undefined }): Model => ({
  kind,
  text,
  value,
  opened: false,
  focused: false,
  stood: null,
  hidden,
  pair: pair !== undefined,
  other: pair?.other,
  otherHeld: false,
  offer: undefined,
  otherOffer: undefined,
  refused: false,
  pending: [],
  leftOut: false,
  closesOverHidden: false,
  hiddenOpen: true,
});

/** Whether the box (its textarea) is on the page: a key box is closed over a key taken, until Replace key or Remove. */
export const present = (m: Model): boolean =>
  m.kind === 'cert' ? !(m.closesOverHidden && !m.hiddenOpen && m.hidden !== undefined && m.value === m.hidden) : !(m.value !== undefined && !m.opened && m.text === '');
/** Text that was not taken (rule 2). */
export const held = (m: Model): boolean => m.text.trim() !== '' && !takes(m.kind, m.text);
/** A key box: the key that stands while nothing new is taken. */
const standing = (m: Model): string | undefined => (m.stood === null ? m.value : m.stood);

function close(m: Model): void {
  m.text = '';
  m.opened = false;
  m.stood = null;
  m.focused = false;
  m.offer = undefined;
  // The box's input goes: its reads in progress and a refused file's reason with it.
  m.refused = false;
  staleReads(m);
}

/** Text arrives in the box (typed, pasted, dropped, an accepted file) while it has focus or not (1′). */
export function arrive(m: Model, next: string, focused: boolean): void {
  // The box changed: a refused file's reason goes (rule 5), and so does every read in progress (item 147).
  m.refused = false;
  staleReads(m);
  const isTaken = takes(m.kind, next);
  // A pair's box offers to split what arrives when it holds a certificate and its key (B23).
  const parts = m.pair ? splitOf(next) : undefined;
  m.offer = parts && { ...parts, from: 'text' };
  if (m.kind === 'key') {
    if (m.stood === null) m.stood = m.value;
    // A whole key is taken (from its BEGIN line) and the box closes at once; a reference stays shown, as it may still be typed.
    if (isTaken && !isRef(next.trim())) {
      m.value = taken('key', next);
      close(m);
      m.leftOut = leftOutOf(next);
      return;
    }
    m.leftOut = false;
    m.text = focused || isTaken ? next : masked(next);
    // Rule 3: while text is held, the value is the last accepted one: a reference taken in this box
    // before the text became unfinished stays (task-14 r3, "The rule for every PEM box", point 3, as
    // the final wave's M4 reads it). Rule 4: an empty box is the key that stood when editing began.
    if (isTaken) m.value = taken('key', next);
    else if (next.trim() === '') m.value = m.stood;
    return;
  }
  m.text = focused || isTaken ? next : masked(next);
  // Held, the value stays the last accepted one (rule 3); empty, none or the value the box cannot show (rule 4).
  if (isTaken) m.value = taken('cert', next);
  else if (next.trim() === '') m.value = m.hidden;
  // A CA box not opened by Replace CA gives way to the stored CA's details once the field holds it again.
  if (!present(m)) {
    m.focused = false;
    m.text = '';
  }
}

/**
 * A file the box refused: the box and the value as they were, its reason standing; the split offer
 * follows what the file held (B23). A file that offers nothing (one that could not be read: `text`
 * '') ends an offer a file made, and leaves the one the box's own text makes (item 144).
 */
export function refusedFile(m: Model, text: string): void {
  m.refused = true;
  const parts = m.pair ? splitOf(text) : undefined;
  if (!parts && m.offer?.from === 'text') return;
  m.offer = parts && { ...parts, from: 'file' };
}

/** The split action, pressed in this box (B23): its part arrives here, the other part in the other box. */
export function split(m: Model): void {
  const parts = m.offer;
  if (!parts) return;
  if (m.kind === 'cert') {
    arrive(m, parts.certs, false);
    m.other = parts.key;
  } else {
    arrive(m, parts.key, false);
    m.other = parts.certs;
  }
  // The other box took its part: whatever it held, and offered, is replaced.
  m.otherHeld = false;
  m.otherOffer = undefined;
  m.offer = undefined;
}

/** The other box's split action, pressed (item 145): this box's part arrives here, the other part there. */
export function otherSplit(m: Model): void {
  const parts = m.otherOffer;
  if (!parts) return;
  arrive(m, m.kind === 'cert' ? parts.certs : parts.key, false);
  m.other = m.kind === 'cert' ? parts.key : parts.certs;
  m.otherHeld = false;
  m.otherOffer = undefined;
}

/** What one box has that an action replaces: nothing, a value entered, text it holds without having taken it, or both. */
type Side = 'none' | 'value' | 'text' | 'both';
const sideOf = (value: boolean, text: boolean): Side => (value ? (text ? 'both' : 'value') : text ? 'text' : 'none');

const C = t('ssl.split.what.cert');
const CT = t('ssl.split.what.certText');
const K = t('ssl.split.what.key');
const KT = t('ssl.split.what.keyText');
/**
 * What an action says it replaces (fix round 1, R8; fix round 2, R8; item 143), by what the
 * certificate box and the key box have, written out from the rule (fix round 1, R3.5): the
 * certificate entered, the text in the certificate box, the key entered, the text in the key box, in
 * that order, the last joined with "and"; the two values alone read "the certificate and the key
 * entered". The box whose action it is has no text named (its text is the action's subject), so only
 * these pairs arise.
 */
const WHAT: Record<string, string | undefined> = {
  'none|none': undefined,
  'none|value': K,
  'none|text': KT,
  'none|both': `${K} and ${KT}`,
  'value|none': C,
  'value|value': t('ssl.split.what.both'),
  'value|text': `${C} and ${KT}`,
  'value|both': `${C}, ${K} and ${KT}`,
  'text|none': CT,
  'text|value': `${CT} and ${K}`,
  'both|none': `${C} and ${CT}`,
  'both|value': `${C}, ${CT} and ${K}`,
};

function actionName(action: 'ssl.split.toKeyBox' | 'ssl.split.toCertBox', cert: Side, key: Side): string {
  const pair = `${cert}|${key}`;
  if (!(pair in WHAT)) throw new Error(`no expected name for ${pair}`);
  const what = WHAT[pair];
  return what === undefined ? t(action) : t(`${action}Replacing`, { what });
}

/**
 * The split action's name in this box: the certificate box's replaces its certificate (the field has
 * a value) and the key entered and text in the key box; the key box's replaces the key that stands
 * and the certificate entered and text in the certificate box. The other box's value is `other`, its
 * text `otherHeld`; this box's own text is the action's subject and is not named.
 */
export function splitLabel(m: Model): string {
  const other = sideOf(m.other !== undefined, m.otherHeld);
  return m.kind === 'cert'
    ? actionName('ssl.split.toKeyBox', sideOf(m.value !== undefined, false), other)
    : actionName('ssl.split.toCertBox', other, sideOf(standing(m) !== undefined, false));
}

/** The name of the other box's action (item 145): it replaces this box's value and the text this box holds. */
export function otherSplitLabel(m: Model): string {
  const own = sideOf(m.value !== undefined, held(m));
  return m.kind === 'cert'
    ? actionName('ssl.split.toCertBox', own, sideOf(m.other !== undefined, false))
    : actionName('ssl.split.toKeyBox', sideOf(m.other !== undefined, false), own);
}
/**
 * What a box says to do by hand, past the split action (fix round 2, R7): none of it while an offer
 * stands in the box, whatever offered it. Every problem a box can state, and a refused file's reason.
 */
const BY_HAND = [
  ...['hasKey', 'fileHasKey', 'incomplete', 'notOneKey', 'refNotAlone', 'markerCert', 'markerKey', 'noCertLabel', 'noKeyLabel', 'isCert', 'encrypted'].map((key) => t(`ssl.pem.${key}`)),
  t('ssl.pem.fileRefused', { problem: '\u0000' }).split('\u0000')[0] as string,
];
/** What a message that names a refused file's bare reason says after it (fix round 1, R3.1: the reason itself stays). */
const after = (key: string): string => t(key, { reason: '\u0000' }).split('\u0000')[1] as string;
/** A refused file's reason in full, as a box says it with no offer standing (rule 5; fix round 1, R3.3). */
const PLAIN_REASONS = [
  t('ssl.pem.fileRefused', { problem: '\u0000' }).split('\u0000')[0] as string,
  t('ssl.pem.fileHasKey'),
  t('ssl.pem.binary'),
  t('ssl.pem.readFailed'),
  t('ssl.pem.tooBig', { size: '\u0000' }).split('\u0000')[1] as string,
];

/** Every name a split action can have, to check that none but the model's is on the page. */
const SPLIT_LABELS = [
  ...new Set(
    (['ssl.split.toKeyBox', 'ssl.split.toCertBox'] as const).flatMap((action) =>
      Object.keys(WHAT).map((pair) => {
        const [cert, key] = pair.split('|') as [Side, Side];
        return actionName(action, cert, key);
      }),
    ),
  ),
];

/** The box loses focus: key blocks in text not taken become markers; nothing opens or closes (rule 9). */
export function leave(m: Model): void {
  m.focused = false;
  if (!takes(m.kind, m.text)) m.text = masked(m.text);
}

// --- Texts, files, actions ------------------------------------------------------------------------

const ENCRYPTED = `-----BEGIN ENCRYPTED PRIVATE KEY-----\n${'E'.repeat(80)}\n-----END ENCRYPTED PRIVATE KEY-----\n`;
const HALF_KEY = '-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49';
/** Text the other box of a pair does not take (the `otherText` action): a half key, or a certificate box's text with no PEM label. */
const OTHER_HELD: Record<Kind, string> = { key: HALF_KEY, cert: 'not a certificate yet' };
/** A combined text given to the other box (the `otherText` action, item 145): it holds it, and offers the split. */
const OTHER_COMBINED: Record<Kind, string> = { key: EC_PAIR.key + EC_PAIR.cert, cert: EC_PAIR.cert + EC_PAIR.key };
/** The files that hold a certificate and its key: a pair's box refuses them and offers the split. */
const COMBINED_FILES = ['combined', 'keyPlusCert', 'p12'];
/** Files every box refuses that offer nothing: beside the text's own offer, they leave it (item 144). */
const PLAIN_REFUSED = ['noLabel', 'empty', 'big', 'binary'];

/** Every kind of text a user may type, paste or drop, for either kind of box. */
export const TEXTS: Record<string, string> = {
  cert: SEED_CERT,
  certB: RSA_LEAF,
  key: SEED_KEY,
  keyB: EC_PAIR.key,
  ecParamsKey: EC_PARAMS_KEY,
  keyThenComment: `${EC_PAIR.key}# rotated in November\n`,
  bagKey: BAG_KEY,
  blankFirst: `\n${SEED_KEY}`,
  halfCert: '-----BEGIN CERTIFICATE-----\nMIIBsDCC',
  halfKey: HALF_KEY,
  halfKeyThenCert: `${HALF_KEY}\n${RSA_LEAF}`,
  halfKeyThenKey: `${HALF_KEY}\n${SEED_KEY}`,
  junk: 'not PEM at all',
  combined: SEED_CERT + SEED_KEY,
  keyPlusCert: SEED_KEY + SEED_CERT,
  commentFirst: `# my key\n${EC_PAIR.key}`,
  // What `openssl pkcs12 -nodes` prints: Bag Attributes, the key, then the certificate and its chain.
  p12: `${BAG_KEY}Bag Attributes\n    localKeyID: 01\nsubject=CN=rsa-extra.apiseven.test\n${RSA_PAIR.cert}${RSA_CA}`,
  certThenEncrypted: SEED_CERT + ENCRYPTED,
  twoKeys: SEED_KEY + EC_PAIR.key,
  encrypted: ENCRYPTED,
  ref: '$secret://vault/1/ssl/pem',
  envRef: '$ENV://SSL_PEM',
  // Taken without the white space around it (Task 16b, item 104); the box keeps what was given.
  refSpaced: '  $secret://vault/1/ssl/spaced \n',
  refThenKey: `$secret://vault/1/ssl\n${SEED_KEY}`,
  refThenText: '$env://SSL_PEM and more',
};
export const TEXT_NAMES = Object.keys(TEXTS);

/** Every kind of file, as text (judged by the model) or refused before it is read. */
export const FILES: Record<string, { file: () => File; text?: string }> = {
  cert: { file: () => new File([RSA_LEAF], 'leaf.crt', { type: 'text/plain' }), text: RSA_LEAF },
  key: { file: () => new File([EC_PAIR.key], 'ec.key', { type: 'text/plain' }), text: EC_PAIR.key },
  ecParamsKey: { file: () => new File([EC_PARAMS_KEY], 'ecparam.key', { type: 'text/plain' }), text: EC_PARAMS_KEY },
  bagKey: { file: () => new File([BAG_KEY], 'export.pem', { type: 'text/plain' }), text: BAG_KEY },
  combined: { file: () => new File([SEED_CERT + SEED_KEY], 'both.pem', { type: 'text/plain' }), text: SEED_CERT + SEED_KEY },
  keyPlusCert: { file: () => new File([SEED_KEY + SEED_CERT], 'both.pem', { type: 'text/plain' }), text: SEED_KEY + SEED_CERT },
  p12: { file: () => new File([TEXTS.p12 as string], 'export.pem', { type: 'text/plain' }), text: TEXTS.p12 },
  ref: { file: () => new File(['$secret://vault/1/ssl/file'], 'ref.txt', { type: 'text/plain' }), text: '$secret://vault/1/ssl/file' },
  // A file as an editor saves it, with a final newline: taken without it (item 104).
  refLine: { file: () => new File(['$env://SSL_FILE\n'], 'ref.env', { type: 'text/plain' }), text: '$env://SSL_FILE\n' },
  refThenKey: { file: () => new File([TEXTS.refThenKey as string], 'ref.pem', { type: 'text/plain' }), text: TEXTS.refThenKey },
  noLabel: { file: () => new File(['hello world'], 'notes.txt', { type: 'text/plain' }), text: 'hello world' },
  empty: { file: () => new File([''], 'empty.pem', { type: 'text/plain' }), text: '' },
  big: { file: () => new File(['A'.repeat(70 * 1024)], 'big.pem', { type: 'text/plain' }) },
  binary: { file: () => new File([new Uint8Array([0x30, 0x82, 0x01, 0x0a, 0x02, 0x01, 0x00, 0xff])], 'cert.crt', { type: 'text/plain' }) },
};
export const FILE_NAMES = Object.keys(FILES);

/**
 * What a user does to a box. Text arrives typed or pasted (focused), dropped on the box or on its
 * upload bar while it has no focus, or dropped on it while it has; a drop may carry nothing; a file
 * comes by a real click on Upload file, now and then one whose reading is left pending across the
 * actions that follow (item 147), each finishing at the start of a later step; the box is emptied,
 * left, returned to; a key box is kept (Keep the entered key) or its key removed; a combined text is
 * split between a pair's boxes (B23), by this box's action or the other's; in a pair, text the other
 * box does not take is typed there (fix round 2, R8), a combined text among it (item 145); and saving
 * is asked for where the level has a save.
 */
export const ACTIONS = ['paste', 'dropBox', 'dropBar', 'dropFocused', 'dropNothing', 'upload', 'empty', 'leave', 'return', 'keep', 'remove', 'split', 'otherText', 'save'] as const;
export type Action = (typeof ACTIONS)[number];

/** The actions a box of this kind offers; `save` only where the level has one. */
export const actionsFor = (kind: Kind, save: boolean): Action[] =>
  ACTIONS.filter((a) => (kind === 'key' || (a !== 'keep' && a !== 'remove')) && (save || a !== 'save'));

/** Counts of what ran, for the coverage report. */
export class Coverage {
  readonly counts: Record<string, number> = {};
  add(name: string): void {
    this.counts[name] = (this.counts[name] ?? 0) + 1;
  }
  get(name: string): number {
    return this.counts[name] ?? 0;
  }
}

// --- Driving a box on the page --------------------------------------------------------------------

const settle = () =>
  act(async () => {
    await new Promise((done) => setTimeout(done, 5));
  });

/**
 * One box on the page and its model. `scope` is where the box is (the page, or a dialog); `label`
 * its field label. `step` performs one action, updating the model as the rule says; `check` asserts
 * the invariants that hold at every level.
 */
export class BoxRun {
  readonly m: Model;
  readonly label: string;
  readonly scope: () => HTMLElement;
  readonly user: UserEvent;
  readonly cov: Coverage;
  /** Files whose reading was left pending (item 147), oldest first, with the way to finish each. */
  private slow: { read: PendingRead; release: () => void }[] = [];
  /** One upload in this many (of a file that is read) is left pending; a level may make it likelier. */
  slowOneIn = 3;

  constructor(m: Model, label: string, scope: () => HTMLElement, user: UserEvent, cov: Coverage) {
    this.m = m;
    this.label = label;
    this.scope = scope;
    this.user = user;
    this.cov = cov;
  }

  box(): HTMLTextAreaElement | null {
    return within(this.scope()).queryByRole<HTMLTextAreaElement>('textbox', { name: this.label });
  }

  private button(name: string): HTMLButtonElement | null {
    return within(this.scope()).queryByRole<HTMLButtonElement>('button', { name });
  }

  /** The box's textarea; a closed key box is opened with Replace key (which gives it focus). */
  async ensureBox(): Promise<HTMLTextAreaElement> {
    const el = this.box();
    if (el) return el;
    if (this.m.kind === 'cert') {
      // A CA box that gave way to the stored CA's details: Replace CA opens it again (no focus moves into it).
      await this.user.click(this.button(t('ssl.client.replaceCa')) as HTMLButtonElement);
      this.m.hiddenOpen = true;
      this.m.focused = false;
      return this.box() as HTMLTextAreaElement;
    }
    await this.user.click(this.button(t('ssl.key.replaceKey')) as HTMLButtonElement);
    this.m.opened = true;
    this.m.focused = true;
    this.m.leftOut = false;
    return this.box() as HTMLTextAreaElement;
  }

  /** Leaves the box if it has focus (a blur, as moving elsewhere does). */
  blur(el: HTMLTextAreaElement): void {
    if (!this.m.focused) return;
    act(() => el.blur());
    leave(this.m);
  }

  focus(el: HTMLTextAreaElement): void {
    act(() => el.focus());
    this.m.focused = true;
  }

  /** The focus moved off the box to something the user clicked (a button): it is left. */
  leftByClick(): void {
    if (this.m.focused) leave(this.m);
  }

  private arrived(text: string, focused: boolean, how: string): void {
    this.cov.add(`text:${how}`);
    if (!focused && keyMaterial(text) && !takes(this.m.kind, text)) this.cov.add('unfocused arrival of key material not taken');
    arrive(this.m, text, focused);
    // Rule 3 where it differs from "the key that stood": held text over a value taken in this box since (final wave M4).
    if (this.m.kind === 'key' && held(this.m) && this.m.stood !== null && this.m.value !== this.m.stood) this.cov.add('key held over a value taken in the box');
  }

  private drop(target: Element, text: string): void {
    fireEvent.drop(target, { dataTransfer: { files: [], getData: (type: string) => (type === 'text/plain' ? text : '') } });
  }

  /** Whether `action` can be taken in the model's state (the generator picks among these). */
  possible(action: Action): boolean {
    const m = this.m;
    switch (action) {
      case 'empty':
      case 'dropNothing':
        return present(m);
      case 'leave':
        return m.focused;
      case 'keep':
        return present(m) && standing(m) !== undefined;
      case 'remove':
        return !present(m);
      case 'split':
        return m.offer !== undefined || m.otherOffer !== undefined;
      case 'otherText':
        // Once it holds text it does not take, typing more of it changes nothing; over a combined text, other text ends its offer.
        return m.pair && (!m.otherHeld || m.otherOffer !== undefined);
      default:
        return true;
    }
  }

  /**
   * Picks the next action among those this box offers now; an offered split is made likelier, as the
   * next text usually ends it; so is a file beside the text's own offer, which a refused one leaves
   * standing (item 144).
   */
  next(r: ReturnType<typeof prng>, save: boolean): Action {
    // Beside the text's own offer, a file a quarter of the time (a refused one leaves the offer: item 144).
    if (this.m.offer?.from === 'text' && r.int(4) === 0) return 'upload';
    // This box's own offer likelier still: a slow file or the other box's action often ends it first.
    if (this.m.offer !== undefined && r.int(2) === 0) return 'split';
    if (this.possible('split') && r.int(3) === 0) return 'split';
    return r.pick(actionsFor(this.m.kind, save).filter((a) => this.possible(a)));
  }

  /**
   * The oldest file read left pending finishes (item 147): ignored when anything happened in the box
   * since it began (it went stale); otherwise judged as an upload is, the box having focus or not.
   */
  async finishRead(): Promise<void> {
    const next = this.slow.shift();
    if (!next) return;
    await act(async () => {
      next.release();
      await Promise.resolve();
    });
    await settle();
    const { read } = next;
    if (read.stale) {
      this.cov.add('a stale read ignored');
      if (read.text === undefined) this.cov.add('a stale read ignored, unreadable');
      return;
    }
    const m = this.m;
    m.pending = m.pending.filter((p) => p !== read);
    this.cov.add('a pending read finished');
    if (read.text !== undefined && takes(m.kind, read.text)) this.arrived(read.text, m.focused, 'late file');
    else {
      const heldBefore = held(m);
      refusedFile(m, read.text ?? '');
      this.cov.add(read.text === undefined ? 'a pending read finished, unreadable' : 'a pending read finished, refused');
      if (m.offer?.from === 'file') this.cov.add('split offered for a refused file');
      if (m.offer?.from === 'file' && heldBefore) this.cov.add('a refused combined file over held text');
    }
  }

  /** Every pending read went stale with the model starting over (a fresh dialog): they finish as nothing. */
  dropReads(): void {
    staleReads(this.m);
  }

  /**
   * A read left pending may finish now, a third of the time, before the step's action: true when one
   * did, so the level checks the page right then, before that action could hide a wrong result (fix
   * round 1, R3.3).
   */
  async settleRead(r: ReturnType<typeof prng>): Promise<boolean> {
    if (this.slow.length === 0 || r.int(3) !== 0) return false;
    await this.finishRead();
    return true;
  }

  /** Performs `action` (save excepted: the level does it); returns false when it could not run here. */
  async step(action: Exclude<Action, 'save'>, r: ReturnType<typeof prng>): Promise<boolean> {
    const m = this.m;
    switch (action) {
      case 'paste':
      case 'empty': {
        const name = action === 'empty' ? undefined : r.pick(TEXT_NAMES);
        const text = name === undefined ? '' : (TEXTS[name] as string);
        if (action === 'empty' && !this.box()) return false;
        const el = await this.ensureBox();
        if (!m.focused) this.focus(el);
        // Select all, then the new text (or nothing). Emptying a box that is empty changes nothing.
        const same = el.value === text;
        fireEvent.change(el, { target: { value: text } });
        if (name) this.cov.add(`text ${name}`);
        if (!same) this.arrived(text, true, action);
        return true;
      }
      case 'dropBox':
      case 'dropBar':
      case 'dropFocused': {
        const name = r.pick(TEXT_NAMES);
        const text = TEXTS[name] as string;
        const el = await this.ensureBox();
        if (action === 'dropFocused') {
          if (!m.focused) this.focus(el);
        } else this.blur(el);
        const target = action === 'dropBar' ? (el.closest('.ssl-pem')?.querySelector('.ssl-pem__bar') as HTMLElement) : el;
        this.drop(target, text);
        this.cov.add(`text ${name}`);
        // A drop gives the box no focus: what was focused stays so.
        this.arrived(text, action === 'dropFocused', action);
        return true;
      }
      case 'dropNothing': {
        const el = this.box();
        if (!el) return false;
        this.drop(r.int(2) === 0 ? el : (el.closest('.ssl-pem') as HTMLElement), '');
        return true;
      }
      case 'upload': {
        // Over text the box holds, a combined file is likelier (fix round 2, R7: its offer over held text);
        // beside the text's own offer, so is a refused file that offers nothing (item 144).
        const bias = m.offer?.from === 'text' ? r.int(3) : m.pair && held(m) ? r.int(2) + 1 : 2;
        const name = bias === 0 ? r.pick(PLAIN_REFUSED) : bias === 1 ? r.pick(COMBINED_FILES) : r.pick(FILE_NAMES);
        const heldBefore = held(m);
        const spec = FILES[name] as (typeof FILES)[string];
        // Now and then a file whose text arrives only later (item 147): its reading stays pending; a
        // binary one too, which is then unreadable (fix round 1, R3.3). A file too big is refused before
        // it is read, so it is never pending.
        const slowText = spec.text ?? (name === 'binary' ? '\u0000\u00ff' : undefined);
        const slow = slowText !== undefined && r.int(this.slowOneIn) === 0 ? deferredFile(spec.file(), slowText) : undefined;
        const el = await this.ensureBox();
        const input = el.closest('.ssl-pem')?.querySelector<HTMLInputElement>('input[type="file"]') as HTMLInputElement;
        let picker = 0;
        const opened = () => picker++;
        input.addEventListener('click', opened);
        // A real click on Upload file: it moves the focus off the box, and must reach the picker (rule 9).
        await this.user.click(this.button(t('ssl.pem.uploadLabel', { label: this.label })) as HTMLButtonElement);
        input.removeEventListener('click', opened);
        this.leftByClick();
        expect(picker, `Upload file reached the file picker (${name})`).toBe(1);
        expect(input.isConnected, 'the file input is still on the page').toBe(true);
        // Another file: every read still in progress in this box goes stale (item 147).
        staleReads(m);
        await this.user.upload(input, slow?.file ?? spec.file());
        await settle();
        this.cov.add(`file ${name}`);
        if (slow) {
          const read: PendingRead = { text: spec.text, stale: false };
          m.pending.push(read);
          this.slow.push({ read, release: slow.release });
          this.cov.add('upload: read left pending');
          return true;
        }
        // Judged before anything changes (rule 5): a refused file changes nothing, but what it held may be split (B23).
        if (spec.text !== undefined && takes(m.kind, spec.text)) this.arrived(spec.text, false, 'file');
        else {
          this.cov.add('file refused');
          const textOffer = m.offer?.from === 'text';
          refusedFile(m, spec.text ?? '');
          if (m.offer?.from === 'file') this.cov.add('split offered for a refused file');
          if (m.offer?.from === 'file' && heldBefore) this.cov.add('a refused combined file over held text');
          if (textOffer && m.offer?.from === 'text') this.cov.add("a refused file left the text's offer");
        }
        return true;
      }
      case 'leave': {
        const el = this.box();
        if (!el || !m.focused) return false;
        this.blur(el);
        return true;
      }
      case 'return': {
        const el = await this.ensureBox();
        if (!m.focused) this.focus(el);
        return true;
      }
      case 'keep': {
        const keep = this.button(t('ssl.key.keep'));
        if (!keep) return false;
        await this.user.click(keep);
        this.leftByClick();
        m.value = standing(m);
        close(m);
        m.leftOut = false;
        return true;
      }
      case 'remove': {
        const remove = this.button(t('ssl.key.remove'));
        if (!remove) return false;
        await this.user.click(remove);
        m.value = undefined;
        m.leftOut = false;
        return true;
      }
      case 'otherText': {
        // Text the other box does not take, typed there (fix round 2, R8), now and then a combined text,
        // which it then offers to split (item 145); over that, other text ends its offer. A closed key box
        // is opened with Replace key first. The focus moves there, so this box is left.
        const combined = m.otherOffer === undefined && r.int(2) === 0;
        const label = t(m.kind === 'cert' ? 'ssl.pem.key' : 'ssl.pem.cert');
        const find = () => within(this.scope()).queryByRole<HTMLTextAreaElement>('textbox', { name: label });
        if (!find()) {
          const open = this.button(t('ssl.key.replaceKey'));
          if (!open) return false;
          await this.user.click(open);
          this.leftByClick();
        }
        const other = find();
        if (!other) return false;
        const box = this.box();
        if (box && m.focused) this.blur(box);
        act(() => other.focus());
        const otherKind = m.kind === 'cert' ? 'key' : 'cert';
        fireEvent.change(other, { target: { value: combined ? OTHER_COMBINED[otherKind] : OTHER_HELD[otherKind] } });
        m.otherHeld = true;
        m.otherOffer = combined ? splitOf(OTHER_COMBINED[otherKind]) : undefined;
        if (combined) this.cov.add('the other box offers');
        m.focused = false;
        return true;
      }
      case 'split': {
        // This box's action (likelier), or the other box's when it offers (item 145).
        const own = m.offer !== undefined && (m.otherOffer === undefined || r.int(4) !== 0);
        const action = this.button(own ? splitLabel(m) : otherSplitLabel(m));
        if (!action) return false;
        // Counted as this box's own split, and by the box whose action it is (fix round 1, R3.4).
        const pressedIn = own ? m.kind : m.kind === 'cert' ? 'key' : 'cert';
        if (own) this.cov.add(`split from the ${m.kind} box`);
        this.cov.add(`split by the ${pressedIn} box's action`);
        if (own && m.otherHeld) this.cov.add(`split from the ${m.kind} box over text in the other box`);
        if (!own) this.cov.add('split from the other box');
        if (!own && held(m)) this.cov.add('split from the other box over text in this box');
        await this.user.click(action);
        // The click left the box (its key blocks became markers), then each part went to its box.
        this.leftByClick();
        m.focused = false;
        if (own) split(m);
        else otherSplit(m);
        return true;
      }
    }
  }

  /** The invariants every level checks after every step. */
  check(where: string): void {
    this.checkBox(where);
    const m = this.m;
    // B23: the split is offered exactly when the model says, under its name, and nowhere else: this
    // box's action, and the other box's while it offers (item 145).
    const offered = new Set([...(m.offer ? [splitLabel(m)] : []), ...(m.otherOffer ? [otherSplitLabel(m)] : [])]);
    // R8, both ways: the name says it replaces text the other box holds, with no value there; and,
    // item 143, both a value and text when both are there.
    if (m.offer && m.otherHeld && m.other === undefined) this.cov.add(`the ${m.kind} box's split names text in the other box`);
    if (m.offer && m.otherHeld && m.other !== undefined) this.cov.add(`the ${m.kind} box's split names a value and text in the other box`);
    for (const label of SPLIT_LABELS) expect(this.button(label) !== null, `${where}: the split action "${label}"`).toBe(offered.has(label));
    // R7 (fix rounds 1 and 2), item 145: an offer stands in either box ⇒ no by-hand message in this
    // box, whatever offered it; its messages point at the action: the combined text's (from the text),
    // or the file's and, over text the box holds, that the action replaces it (from a file); a refused
    // file beside the text's offer says only that it was not put here (item 144); while the other box
    // offers, that its action replaces this box's text, and a refused file's reason says so too.
    // Without an offer, none of these.
    const box = this.box();
    if (box) {
      const said = box.closest('.ui-field')?.querySelector('.ui-field__error')?.textContent ?? '';
      if (m.offer || m.otherOffer) for (const message of BY_HAND) expect(said.includes(message), `${where}: a by-hand message beside the split: "${message}"`).toBe(false);
      if (!m.offer && m.otherOffer && (held(m) || m.refused)) this.cov.add("this box's messages point at the other box's action");
      expect(said.includes(t('ssl.split.held')), `${where}: the box's message points at the split (its text)`).toBe(m.offer?.from === 'text');
      expect(said.includes(t('ssl.split.file')), `${where}: the file's reason points at the split`).toBe(m.offer?.from === 'file');
      const over = t(m.kind === 'cert' ? 'ssl.split.overCert' : 'ssl.split.overKey');
      expect(said.includes(over), `${where}: the box's message says the split replaces its text`).toBe(m.offer?.from === 'file' && held(m));
      expect(said.includes(after('ssl.split.fileOverText')), `${where}: a refused file beside the text's offer`).toBe(m.offer?.from === 'text' && m.refused);
      // A refused file's reason in full stands exactly while the model has one and no offer stands (fix round 1, R3.3).
      const plain = PLAIN_REASONS.some((reason) => said.includes(reason));
      expect(plain, `${where}: a refused file's reason in full`).toBe(m.refused && m.offer === undefined && m.otherOffer === undefined);
      if (plain) this.cov.add("a refused file's reason in full");
      const byOther = t(m.kind === 'cert' ? 'ssl.split.byKeyBox' : 'ssl.split.byCertBox');
      expect(said.includes(byOther), `${where}: the box's message points at the other box's action`).toBe(!m.offer && m.otherOffer !== undefined && held(m));
      const fileByOther = after(m.kind === 'cert' ? 'ssl.split.fileByKeyBox' : 'ssl.split.fileByCertBox');
      expect(said.includes(fileByOther), `${where}: a refused file's reason points at the other box's action`).toBe(!m.offer && m.otherOffer !== undefined && m.refused);
    }
  }

  /**
   * A new SSL's line "Enter the private key that belongs to this certificate": while the pair has a
   * certificate and no key, unless a box offers the split (fix round 2, R11). `cert` and `key` are
   * the pair's values as the model has them.
   */
  checkKeyNeeded(where: string): void {
    const m = this.m;
    const [cert, key] = m.kind === 'cert' ? [m.value, m.other] : [m.other, m.value];
    const shown = within(this.scope()).queryByText(t('ssl.key.needed')) !== null;
    expect(shown, `${where}: "Enter the private key"`).toBe(cert !== undefined && key === undefined && m.offer === undefined && m.otherOffer === undefined);
  }

  private checkBox(where: string): void {
    const m = this.m;
    // 1. No whole private-key block in the markup unless the textarea that holds it has focus.
    const active = document.activeElement;
    const focusedText = active instanceof HTMLTextAreaElement ? active.value : '';
    for (const block of document.body.innerHTML.match(WHOLE_KEY) ?? []) {
      expect(focusedText.includes(block), `${where}: a whole private key on the page outside the focused box`).toBe(true);
    }
    for (const el of document.querySelectorAll('textarea')) {
      if (el !== active) expect(new RegExp(WHOLE_KEY.source).test(el.value), `${where}: a whole private key in a box without focus`).toBe(false);
    }
    // The box: there or not, what it shows, whether it has focus.
    const el = this.box();
    expect(el !== null, `${where}: the box is on the page`).toBe(present(m));
    if (el) {
      expect(el.value, `${where}: the box's text`).toBe(m.text);
      expect(el === active, `${where}: the box has focus`).toBe(m.focused);
    }
    const scope = within(this.scope());
    const shows = (key: string) => scope.queryByText(t(key)) !== null;
    if (m.kind === 'key') {
      // Rule 9: Keep the entered key wherever an open box stands over a key.
      expect(this.button(t('ssl.key.keep')) !== null, `${where}: Keep the entered key`).toBe(present(m) && standing(m) !== undefined);
      // What the page says of the key (rules 3, 4): entered (closed), or what stays while held or empty.
      const quiet = present(m) && (held(m) || m.text.trim() === '');
      expect(shows('ssl.key.entered'), `${where}: "entered"`).toBe(!present(m));
      // B23: a key taken from its BEGIN line says when what came before it was left out.
      expect(shows('ssl.key.leftOut'), `${where}: the lines before the key were left out`).toBe(!present(m) && m.leftOut);
      expect(shows('ssl.key.stays'), `${where}: the key that stood stays`).toBe(quiet && m.value !== undefined);
      expect(shows('ssl.key.none'), `${where}: no key`).toBe(quiet && m.value === undefined);
    } else {
      const empty = m.text.trim() === '';
      const note = !present(m)
        ? undefined
        : m.hidden !== undefined && m.value === m.hidden && (held(m) || empty)
          ? 'ssl.box.hiddenStays'
          : held(m)
            ? m.value === undefined
              ? 'ssl.box.keptNone'
              : 'ssl.box.keptCert'
            : undefined;
      for (const key of ['ssl.box.hiddenStays', 'ssl.box.keptNone', 'ssl.box.keptCert']) expect(shows(key), `${where}: the note ${key}`).toBe(note === key);
      // A CA box that gave way to the stored CA it cannot show: that CA's details stand in its place,
      // with the warning that it holds a key and Replace CA (fix round 3); while the box is open, none of these.
      if (m.closesOverHidden) {
        const details = !present(m);
        expect(this.button(t('ssl.client.replaceCa')) !== null, `${where}: Replace CA`).toBe(details);
        expect(shows('ssl.cert.holdsKey'), `${where}: the stored CA's warning`).toBe(details);
        expect(scope.queryByRole('definition', { name: t('ssl.cert.subject') }) !== null, `${where}: the stored CA's details`).toBe(details);
        if (details) this.cov.add("the stored CA's details stand in for the box");
      }
    }
  }
}

/** Runs `run` and returns its first failure as one line, or undefined. */
export async function firstFailure(run: () => Promise<void>): Promise<string | undefined> {
  try {
    await run();
    return undefined;
  } catch (err) {
    return (err instanceof Error ? err.message : String(err)).split('\n')[0];
  }
}
