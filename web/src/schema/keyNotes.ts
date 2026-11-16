// Private keys in JSON text that is being edited (final wave fix round 1, R1): a value that holds a PEM
// private key is never shown, so every editing JSON view (the editor's JSON tab, a plugin card's JSON,
// a schema-form JSON field) shows a note in its place. Each note is a token for one key text, made in
// one editing session (`session`, random, so unique across page loads) and never reused: it resolves
// to the key it was made for or to nothing, never to another key by its position, never to itself.
// The SSL editor's notes (plugins/secrets.ts veilKeys) are these, with an SSL's `key` and `keys` as
// keys whole. A note resolves only where it was made (fix round 2, R1.2): at the exact path of the text
// it stands in, or, for a group of places the caller names (an SSL's key and certificate slots, whose
// pairs the user may swap), at any place of the group; anywhere else it is refused, so a stored key can
// never be moved into another field (a header, a description) by moving its note.
import { t } from '../i18n';
import { isObj } from './refs';
import { holdsPrivateKey, isNeverShownName, MASK, withoutPrivateKeys } from './secrets';

export interface KeyNotes {
  /** Random (randomId): a note made on another page load never names this session. */
  readonly session: string;
  /** note text → the key text it stands for */
  readonly keys: ReadonlyMap<string, string>;
  /** note text → where it was made (placeOf); none for a note made in text being typed, which is the user's own key. */
  readonly at: ReadonlyMap<string, string>;
}

/**
 * A session id no other page load (another browser tab, a reload) makes: 8 base-36 characters from
 * crypto.getRandomValues, which browsers offer on any origin (crypto.subtle only on secure ones). A
 * counter would start again at 1 on every load, so a note copied between tabs would name the same
 * session and resolve to the other object's keys.
 */
function randomId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => (b % 36).toString(36)).join('');
}

/** A new, empty set of notes for an editing session. */
export function newKeyNotes(): KeyNotes {
  return { session: randomId(), keys: new Map(), at: new Map() };
}

/** Places a caller names as one (an SSL's key and certificate slots), where a note may move freely. */
export type PlaceGroup = (path: readonly (string | number)[]) => boolean;

/** Where a text is, as notes remember it: its path, or the group it belongs to. */
const placeOf = (path: readonly (string | number)[], group: PlaceGroup | undefined): string => (group?.(path) ? '#group' : JSON.stringify(path));

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** What a note reads (json.keyNote), as a pattern: any session's, any number. */
const notePattern = (): RegExp => new RegExp(escape(t('json.keyNote', { id: '\u0000' })).replace('\u0000', '[0-9a-z.]+'), 'g');

/** A note's words with a session and number ("private key abcdefgh.1"), made once. */
let noteWords: RegExp | undefined;

/** What is left of a note changed by hand: two of its mask dots, or its words with a session and number. */
function leftOfNote(text: string): boolean {
  if (text.includes('••')) return true;
  if (!noteWords) {
    const words = t('json.keyNote', { id: '\u0000' }).replace(MASK, '').split('\u0000')[0]?.trim() ?? '';
    noteWords = new RegExp(`${escape(words)} [0-9a-z]{8}\\.\\d+`);
  }
  return noteWords.test(text);
}

/** Where a text is a key as a whole (an SSL's `key`): `path` from the value's root, `key` the property it is under. */
export type WholeKey = (path: readonly (string | number)[], key: string | undefined) => boolean;

/** A text under a never-shown name (client_key) is a key as a whole; elsewhere, its private-key blocks are. */
const byName: WholeKey = (_path, key) => key !== undefined && isNeverShownName(key);

/**
 * `value` as an editing JSON view shows it: every text that is a key as a whole (`whole`; by default
 * one under a never-shown name, client_key) replaced by its note, and every private-key block in any
 * other text replaced by its note in place, the rest of the text kept. `under`: the value itself sits
 * under that property. A key that has no note yet gets a new one (`mint`; without it, `complete` says
 * some had none and the key stays as it is).
 */
export function veilValue(
  value: unknown,
  notes: KeyNotes,
  opts: { mint?: boolean; whole?: WholeKey; group?: PlaceGroup; under?: string } = {},
): { value: unknown; notes: KeyNotes; veiled: boolean; complete: boolean } {
  const { mint = true, under } = opts;
  const keys = new Map(notes.keys);
  const at = new Map(notes.at);
  const used = new Set<string>();
  let complete = true;
  let bound = false;
  /** The note for `secret` at `place`: one made there, else one made in typed text (it is bound here now), else a new one. */
  const noteFor = (secret: string, place: string): string => {
    let free: string | undefined;
    for (const [note, text] of keys) {
      if (text !== secret || used.has(note)) continue;
      const made = at.get(note);
      if (made === place) {
        used.add(note);
        return note;
      }
      if (made === undefined) free ??= note;
    }
    if (free !== undefined) {
      used.add(free);
      at.set(free, place);
      bound = true;
      return free;
    }
    if (!mint) {
      complete = false;
      return secret;
    }
    const note = t('json.keyNote', { id: `${notes.session}.${keys.size + 1}` });
    keys.set(note, secret);
    at.set(note, place);
    used.add(note);
    return note;
  };
  const walk = (v: unknown, path: (string | number)[], key: string | undefined): unknown => {
    if (typeof v === 'string') {
      const place = placeOf(path, opts.group);
      // A whole key the caller names (an SSL's) is a note even when empty; a never-shown name's text when it has any.
      if (opts.whole?.(path, key) === true || (byName(path, key) && v !== '')) return noteFor(v, place);
      return holdsPrivateKey(v) ? withoutPrivateKeys(v, (block) => noteFor(block, place)) : v;
    }
    if (Array.isArray(v)) return v.map((x, i) => walk(x, [...path, i], key));
    if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, [...path, k], k)]));
    return v;
  };
  const out = walk(value, [], under);
  if (used.size === 0 && complete) return { value, notes, veiled: false, complete };
  return { value: out, notes: keys.size === notes.keys.size && !bound ? notes : { session: notes.session, keys, at }, veiled: used.size > 0, complete };
}

/** Every text in `value`, at any depth. */
function textsOf(value: unknown, out = new Set<string>()): Set<string> {
  if (typeof value === 'string') out.add(value);
  else if (Array.isArray(value)) for (const x of value) textsOf(x, out);
  else if (isObj(value)) for (const x of Object.values(value)) textsOf(x, out);
  return out;
}

/**
 * `edited` (an editing JSON view's text, parsed) with each note turned back into the key it was made
 * for, wherever it now is. A text that is a key as a whole (`whole`, as for veilValue) and holds a note's
 * mark must be exactly one note. Refused (`problem`: the text then holds Save as unfinished input, never
 * sent) when a note stands for no key of this session (changed by hand, pasted from another view or
 * another page, left from an earlier session), is used twice (each stands for one key), or is left
 * damaged in a text. `before` is the value the text was made from: a text it already held is never
 * taken for a damaged note. Text typed over a note is kept as typed.
 */
export function unveilValue(
  edited: unknown,
  notes: KeyNotes,
  opts: { whole?: WholeKey; group?: PlaceGroup; under?: string; before?: unknown } = {},
): { ok: true; value: unknown } | { ok: false; problem: string } {
  const whole = opts.whole ?? byName;
  const kept = textsOf(opts.before);
  const seen = new Set<string>();
  let problem: string | undefined;
  let changed = false;
  const resolve = (note: string, place: string): string => {
    const text = notes.keys.get(note);
    const made = notes.at.get(note);
    if (text === undefined) problem ??= t('json.note.unknown');
    else if (seen.has(note)) problem ??= t('json.note.twice');
    else if (made !== undefined && made !== place) problem ??= t('json.note.moved');
    seen.add(note);
    return text ?? note;
  };
  const walk = (v: unknown, path: (string | number)[], key: string | undefined): unknown => {
    if (typeof v === 'string') {
      if (!v.includes(MASK.slice(0, 1)) && !leftOfNote(v)) return v;
      const place = placeOf(path, opts.group);
      if (whole(path, key) || byName(path, key)) {
        if (kept.has(v)) return v;
        if (v.includes(MASK.slice(0, 1))) {
          // Exactly one note, white space around it kept (a key pasted with its last line break, then veiled).
          const note = v.trim();
          const one = notePattern().exec(note);
          if (one?.index !== 0 || one[0] !== note) {
            problem ??= t('json.note.unknown');
            return v;
          }
          changed = true;
          return v.replace(note, () => resolve(note, place));
        }
        if (!kept.has(v)) problem ??= t('json.note.unknown');
        return v;
      }
      const back = v.replace(notePattern(), (note) => resolve(note, place));
      // A note changed by hand no longer matches: what is left of it must not be sent.
      if (leftOfNote(back) && !(back === v && kept.has(v))) problem ??= t('json.note.unknown');
      if (back !== v) changed = true;
      return back;
    }
    if (Array.isArray(v)) return v.map((x, i) => walk(x, [...path, i], key));
    if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, [...path, k], k)]));
    return v;
  };
  const out = walk(edited, [], opts.under);
  if (problem !== undefined) return { ok: false, problem };
  return { ok: true, value: changed ? out : edited };
}

/** Whole PEM private-key blocks in raw text, each from its BEGIN line to its own END line. */
const TYPED_KEY_BLOCKS = /-----BEGIN ([A-Z0-9 ]*)PRIVATE KEY-----[\s\S]*?-----END \1PRIVATE KEY-----/g;

/** The key text a block of raw JSON text stands for: written with JSON escapes (\n) inside a string, its unescaped text. */
function keyTextOf(block: string): string {
  if (block.includes('\n') || !block.includes('\\')) return block;
  try {
    const text: unknown = JSON.parse(`"${block}"`);
    return typeof text === 'string' ? text : block;
  } catch {
    return block;
  }
}

/**
 * Raw text being typed in an editing JSON view, which may not parse, with every whole PEM private-key
 * block replaced by a new note of this session (fix round 2, R1.4): for leaving the view, so no key
 * rests on the page outside the text being typed, whether or not the text is taken. Such a note is
 * made in typed text: it stands for the user's own key and is bound to the place where the text first
 * puts it. A block with no END line is left as typed.
 */
export function veilTypedText(text: string, notes: KeyNotes): { text: string; notes: KeyNotes; veiled: boolean } {
  if (!text.includes('-----BEGIN')) return { text, notes, veiled: false };
  const keys = new Map(notes.keys);
  const out = text.replace(TYPED_KEY_BLOCKS, (block) => {
    const note = t('json.keyNote', { id: `${notes.session}.${keys.size + 1}` });
    keys.set(note, keyTextOf(block));
    return note;
  });
  return out === text ? { text, notes, veiled: false } : { text: out, notes: { session: notes.session, keys, at: notes.at }, veiled: true };
}
