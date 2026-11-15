// What the two PEM box property tests share (resources/ssls/pemBoxes.property.test.tsx, at tab level,
// and pemBoxes.page.property.test.tsx, through the real editor frame): the texts and files, a
// reference model of the rule (task-14 r3 "The rule for every PEM box" with the r4 amendments, and
// Task 16 B23: a key taken from its first BEGIN line, a combined PEM split between a pair's boxes),
// the actions a user takes on a box, a seeded generator of them, and the checks made after every step.
// The model states the rule on its own; it imports nothing from the boxes' code.
import { act, fireEvent, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { expect } from 'vitest';
import { t } from '../i18n';
import { RSA_LEAF } from './certs';
import { RSA_CA } from './certs';
import { BAG_KEY, EC_PAIR, EC_PARAMS_KEY, RSA_PAIR } from './pairs';
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

/** The value a box takes from `text`: a key from its first BEGIN line (APISIX refuses anything before it, ssl.lua 89–104); anything else as it is. */
export function taken(kind: Kind, text: string): string {
  const at = text.indexOf('-----BEGIN');
  return kind === 'key' && !isRef(text.trim()) && at > 0 ? text.slice(at) : text;
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
  /** A key box: the key that stood when this opening's editing began; null before it began. */
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
  /** A key box closed over a key whose lines before its BEGIN line were left out says so. */
  leftOut: boolean;
}

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
  leftOut: false,
});

/** Whether the box (its textarea) is on the page: a key box is closed over a key taken, until Replace key or Remove. */
export const present = (m: Model): boolean => m.kind === 'cert' || !(m.value !== undefined && !m.opened && m.text === '');
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
}

/** Text arrives in the box (typed, pasted, dropped, an accepted file) while it has focus or not (1′). */
export function arrive(m: Model, next: string, focused: boolean): void {
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
    m.value = isTaken ? next : m.stood;
    return;
  }
  m.text = focused || isTaken ? next : masked(next);
  if (isTaken) m.value = next;
  else if (next.trim() === '') m.value = m.hidden;
}

/**
 * A file the box refused: the box and the value as they were; the split offer follows what the file
 * held (B23), and a file that could not be read (`text` '') offers nothing, so whatever the last file
 * or text offered ends with it.
 */
export function refusedFile(m: Model, text: string): void {
  const parts = m.pair ? splitOf(text) : undefined;
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
  // The other box took its part: whatever it held is replaced.
  m.otherHeld = false;
  m.offer = undefined;
}

/**
 * The split action's name in this box: it says what it replaces (fix round 1, R8). The certificate
 * box's replaces its certificate (the field has a value) and the key entered or text in the key box
 * (fix round 2, R8); the key box's replaces the key that stands and the certificate entered or text
 * in the certificate box. The other box's text is its value's, or text it holds (`otherHeld`).
 */
export function splitLabel(m: Model): string {
  const cert = m.kind === 'cert' ? m.value !== undefined : m.other !== undefined || m.otherHeld;
  const key = m.kind === 'cert' ? m.other !== undefined || m.otherHeld : standing(m) !== undefined;
  const what = cert && key ? 'both' : cert ? 'cert' : key ? 'key' : undefined;
  const action = m.kind === 'cert' ? 'ssl.split.toKeyBox' : 'ssl.split.toCertBox';
  return what ? t(`${action}Replacing`, { what: t(`ssl.split.what.${what}`) }) : t(action);
}
/**
 * What a box says to do by hand, past the split action (fix round 2, R7): none of it while an offer
 * stands in the box, whatever offered it. Every problem a box can state, and a refused file's reason.
 */
const BY_HAND = [
  ...['hasKey', 'fileHasKey', 'incomplete', 'notOneKey', 'refNotAlone', 'markerCert', 'markerKey', 'noCertLabel', 'noKeyLabel', 'isCert', 'encrypted'].map((key) => t(`ssl.pem.${key}`)),
  t('ssl.pem.fileRefused', { problem: '\u0000' }).split('\u0000')[0] as string,
];
/** Every name a split action can have, to check that none but the model's is on the page. */
const SPLIT_LABELS = ['ssl.split.toKeyBox', 'ssl.split.toCertBox'].flatMap((action) => [t(action), ...['cert', 'key', 'both'].map((what) => t(`${action}Replacing`, { what: t(`ssl.split.what.${what}`) }))]);

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
/** The files that hold a certificate and its key: a pair's box refuses them and offers the split. */
const COMBINED_FILES = ['combined', 'keyPlusCert', 'p12'];

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
 * comes by a real click on Upload file; the box is emptied, left, returned to; a key box is kept
 * (Keep the entered key) or its key removed; a combined text is split between a pair's boxes (B23);
 * in a pair, text the other box does not take is typed there (fix round 2, R8); and saving is asked
 * for where the level has a save.
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
        return m.offer !== undefined;
      case 'otherText':
        // Once it holds that text, typing it again changes nothing.
        return m.pair && !m.otherHeld;
      default:
        return true;
    }
  }

  /** Picks the next action among those this box offers now; an offered split is made likelier, as the next text usually ends it. */
  next(r: ReturnType<typeof prng>, save: boolean): Action {
    if (this.possible('split') && r.int(3) === 0) return 'split';
    return r.pick(actionsFor(this.m.kind, save).filter((a) => this.possible(a)));
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
        // Over text the box holds, a combined file is likelier (fix round 2, R7: its offer over held text).
        const name = m.pair && held(m) && r.int(2) === 0 ? r.pick(COMBINED_FILES) : r.pick(FILE_NAMES);
        const heldBefore = held(m);
        const spec = FILES[name] as (typeof FILES)[string];
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
        await this.user.upload(input, spec.file());
        await settle();
        this.cov.add(`file ${name}`);
        // Judged before anything changes (rule 5): a refused file changes nothing, but what it held may be split (B23).
        if (spec.text !== undefined && takes(m.kind, spec.text)) this.arrived(spec.text, false, 'file');
        else {
          this.cov.add('file refused');
          refusedFile(m, spec.text ?? '');
          if (m.offer) this.cov.add('split offered for a refused file');
          if (m.offer && heldBefore) this.cov.add('a refused combined file over held text');
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
        // Text the other box does not take, typed there (fix round 2, R8): a closed key box is opened
        // with Replace key first. The focus moves there, so this box is left.
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
        fireEvent.change(other, { target: { value: OTHER_HELD[m.kind === 'cert' ? 'key' : 'cert'] } });
        m.otherHeld = true;
        m.focused = false;
        return true;
      }
      case 'split': {
        const action = this.button(splitLabel(m));
        if (!action || !m.offer) return false;
        this.cov.add(`split from the ${m.kind} box`);
        if (m.otherHeld) this.cov.add(`split from the ${m.kind} box over text in the other box`);
        await this.user.click(action);
        // The click left the box (its key blocks became markers), then each part went to its box.
        this.leftByClick();
        m.focused = false;
        split(m);
        return true;
      }
    }
  }

  /** The invariants every level checks after every step. */
  check(where: string): void {
    this.checkBox(where);
    const m = this.m;
    // B23: the split is offered exactly when the model says, under its name, and nowhere else.
    const offered = m.offer ? splitLabel(m) : undefined;
    // R8, both ways: the name says it replaces text the other box holds, with no value there.
    if (m.offer && m.otherHeld && m.other === undefined) this.cov.add(`the ${m.kind} box's split names text in the other box`);
    for (const label of SPLIT_LABELS) expect(this.button(label) !== null, `${where}: the split action "${label}"`).toBe(offered === label);
    // R7 (fix rounds 1 and 2): an offer stands ⇒ no by-hand message in the box, whatever offered it;
    // its messages point at the action: the combined text's (from the text), or the file's and, over
    // text the box holds, that the action replaces it (from a file). Without an offer, none of these.
    const box = this.box();
    if (box) {
      const said = box.closest('.ui-field')?.querySelector('.ui-field__error')?.textContent ?? '';
      if (m.offer) for (const message of BY_HAND) expect(said.includes(message), `${where}: a by-hand message beside the split: "${message}"`).toBe(false);
      expect(said.includes(t('ssl.split.held')), `${where}: the box's message points at the split (its text)`).toBe(m.offer?.from === 'text');
      expect(said.includes(t('ssl.split.file')), `${where}: the file's reason points at the split`).toBe(m.offer?.from === 'file');
      const over = t(m.kind === 'cert' ? 'ssl.split.overCert' : 'ssl.split.overKey');
      expect(said.includes(over), `${where}: the box's message says the split replaces its text`).toBe(m.offer?.from === 'file' && held(m));
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
    expect(shown, `${where}: "Enter the private key"`).toBe(cert !== undefined && key === undefined && m.offer === undefined);
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
      const note =
        m.hidden !== undefined && m.value === m.hidden && (held(m) || empty) ? 'ssl.box.hiddenStays' : held(m) ? (m.value === undefined ? 'ssl.box.keptNone' : 'ssl.box.keptCert') : undefined;
      for (const key of ['ssl.box.hiddenStays', 'ssl.box.keptNone', 'ssl.box.keptCert']) expect(shows(key), `${where}: the note ${key}`).toBe(note === key);
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
