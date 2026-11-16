// Private keys in JSON text that is being edited (final wave fix round 1, R1): a value that holds a PEM
// private key is never shown, so every editing JSON view (the editor's JSON tab, a plugin card's JSON,
// a schema-form JSON field) shows a note in its place. Each note is a token for one key text, made in
// one editing session (`session`, random, so unique across page loads) and never reused: it resolves
// to the key it was made for or to nothing, never to another key by its position, never to itself.
// The SSL editor's notes (plugins/secrets.ts veilKeys) are these, with an SSL's `key` and `keys` as
// keys whole.
import { t } from '../i18n';
import { isObj } from './refs';
import { holdsPrivateKey, isNeverShownName, MASK, withoutPrivateKeys } from './secrets';

export interface KeyNotes {
  /** Random (randomId): a note made on another page load never names this session. */
  readonly session: string;
  /** note text → the key text it stands for */
  readonly keys: ReadonlyMap<string, string>;
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
  return { session: randomId(), keys: new Map() };
}

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
  opts: { mint?: boolean; whole?: WholeKey; under?: string } = {},
): { value: unknown; notes: KeyNotes; veiled: boolean; complete: boolean } {
  const { mint = true, under } = opts;
  const keys = new Map(notes.keys);
  const used = new Set<string>();
  let complete = true;
  const noteFor = (secret: string): string => {
    for (const [note, text] of keys) {
      if (text === secret && !used.has(note)) {
        used.add(note);
        return note;
      }
    }
    if (!mint) {
      complete = false;
      return secret;
    }
    const note = t('json.keyNote', { id: `${notes.session}.${keys.size + 1}` });
    keys.set(note, secret);
    used.add(note);
    return note;
  };
  const walk = (v: unknown, path: (string | number)[], key: string | undefined): unknown => {
    if (typeof v === 'string') {
      // A whole key the caller names (an SSL's) is a note even when empty; a never-shown name's text when it has any.
      if (opts.whole?.(path, key) === true || (byName(path, key) && v !== '')) return noteFor(v);
      return holdsPrivateKey(v) ? withoutPrivateKeys(v, noteFor) : v;
    }
    if (Array.isArray(v)) return v.map((x, i) => walk(x, [...path, i], key));
    if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, [...path, k], k)]));
    return v;
  };
  const out = walk(value, [], under);
  if (used.size === 0 && complete) return { value, notes, veiled: false, complete };
  return { value: out, notes: keys.size === notes.keys.size ? notes : { session: notes.session, keys }, veiled: used.size > 0, complete };
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
  opts: { whole?: WholeKey; under?: string; before?: unknown } = {},
): { ok: true; value: unknown } | { ok: false; problem: string } {
  const whole = opts.whole ?? byName;
  const kept = textsOf(opts.before);
  const seen = new Set<string>();
  let problem: string | undefined;
  let changed = false;
  const resolve = (note: string): string => {
    const text = notes.keys.get(note);
    if (text === undefined) problem ??= t('json.note.unknown');
    else if (seen.has(note)) problem ??= t('json.note.twice');
    seen.add(note);
    return text ?? note;
  };
  const walk = (v: unknown, path: (string | number)[], key: string | undefined): unknown => {
    if (typeof v === 'string') {
      if (!v.includes(MASK.slice(0, 1)) && !leftOfNote(v)) return v;
      if (whole(path, key) || byName(path, key)) {
        if (kept.has(v)) return v;
        if (v.includes(MASK.slice(0, 1))) {
          changed = true;
          return resolve(v);
        }
        if (!kept.has(v)) problem ??= t('json.note.unknown');
        return v;
      }
      const back = v.replace(notePattern(), resolve);
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
