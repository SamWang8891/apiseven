// Private keys in JSON text that is being edited (the editor's JSON tab, a plugin card's JSON view, a
// schema-form JSON field). The rule this module implements (final wave, fix round 3):
//  1. A key text is the whole text of a whole-key place (an SSL's `key` and each of its `keys`, any
//     text under a never-shown name such as client_key), or each PEM private-key block of any other
//     text (schema/secrets.ts holdsPrivateKey / withoutPrivateKeys: the SSL editor's detection).
//  2. A note is a token that stands for one key text, in one editing session of one view (`session`,
//     random). It remembers the path it was made at (`at`); a note made from text being typed has none
//     (the user's own key) until it is first taken somewhere.
//  3. Veiling turns key texts into notes: a whole-key place's text into one note, a block into a note
//     in place. A value shown for editing is veiled (veilValue). Leaving a view veils its raw text,
//     string by string, whether or not it parses (veilTypedText): a block never crosses the end of the
//     string it starts in, and only a whole block (BEGIN to its END line) is veiled.
//  4. Taking text back (unveilValue) resolves every note in every text, in place, to its key text when
//     it is a note of this session, appears once in the text, and stands where it may: at its own path;
//     anywhere in the caller's group with it (an SSL's key and certificate slots); or at a path that
//     differs from its own only in array indices, when no note stands at its own path any more. A note
//     made in typed text resolves where it stands.
//  5. Anything else holds the text (Save is refused, nothing is sent): a note of no key of this session,
//     one used twice, one out of place (the message names the path it belongs to), what is left of a
//     note (a whole mask run, its words with an id, an id with its tail, an id of this session) in a text
//     the value did not already hold, and a note's mark in a property name.
//  6. The cheap checks on raw text (mayHoldKeys, mayHoldNotes) let a view skip a walk; they are true for
//     any text with a `\u` escape, which can spell anything.
import { t } from '../i18n';
import { isObj } from './refs';
import { holdsPrivateKey, isNeverShownName, MASK, NEVER_SHOWN, withoutPrivateKeys } from './secrets';

export interface KeyNotes {
  /** Random (randomId): a note made on another page load never names this session. */
  readonly session: string;
  /** note text → the key text it stands for */
  readonly keys: ReadonlyMap<string, string>;
  /** note text → the path it was made at (JSON); none for a note made in text being typed. */
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

type Path = readonly (string | number)[];

/** Places a caller names as one (an SSL's key and certificate slots), where a note may move freely. */
export type PlaceGroup = (path: Path) => boolean;

/** Where a text is a key as a whole (an SSL's `key`): `path` from the value's root, `key` the property it is under. */
export type WholeKey = (path: Path, key: string | undefined) => boolean;

/** A text under a never-shown name (client_key) is a key as a whole; elsewhere, its private-key blocks are. */
const byName: WholeKey = (_path, key) => key !== undefined && isNeverShownName(key);

/** Whether the text at `path` (under `key`) is a key as a whole (rule 1). */
const isWhole = (whole: WholeKey | undefined, path: Path, key: string | undefined): boolean => whole?.(path, key) === true || byName(path, key);

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** What a note reads (json.keyNote), as a pattern: any session's, any number. */
const notePattern = (): RegExp => new RegExp(escape(t('json.keyNote', { id: '\u0000' })).replace('\u0000', '[0-9a-z.]+'), 'g');

/** The parts of a note around its id ("•••••••• private key " and ", not shown"), made once. */
let noteParts: { words: RegExp; tail: RegExp } | undefined;
function parts(): { words: RegExp; tail: RegExp } {
  if (!noteParts) {
    const [head = '', tail = ''] = t('json.keyNote', { id: '\u0000' }).split('\u0000');
    const words = head.replace(MASK, '').trim();
    noteParts = { words: new RegExp(`${escape(words)} [0-9a-z]{8}\\.\\d+`), tail: new RegExp(`[0-9a-z]{8}\\.\\d+${escape(tail)}`) };
  }
  return noteParts;
}

/**
 * What is left of a note changed by hand (rule 5): a whole mask run (what a note and a masked value
 * start with), its words with an id, an id with its tail, or an id of this `session`. Fewer dots are
 * ordinary text ("steps •• done").
 */
function leftOfNote(text: string, session?: string): boolean {
  if (text.includes(MASK)) return true;
  const { words, tail } = parts();
  if (words.test(text) || tail.test(text)) return true;
  return session !== undefined && new RegExp(`${session}\\.\\d`).test(text);
}

/** Whether JSON text may hold a note or what is left of one (rule 6): false lets a view skip unveilValue. */
export function mayHoldNotes(text: string, session?: string): boolean {
  return text.includes(MASK.slice(0, 1)) || text.includes('\\u') || leftOfNote(text, session);
}

/**
 * Whether JSON text may say something veilValue would veil (rule 6): a note, a PEM BEGIN line, a
 * never-shown name, or an escape. For text that says a value exactly (JSON of it), false means the
 * value holds none of these.
 */
export function mayHoldKeys(text: string, session?: string): boolean {
  return mayHoldNotes(text, session) || text.includes('-----BEGIN') || [...NEVER_SHOWN].some((name) => text.includes(`"${name}"`));
}

/** Whether a note made at `made` (JSON) may stand at `path` for being in the caller's group with it. */
const sameGroup = (group: PlaceGroup | undefined, made: Path, path: Path): boolean => group !== undefined && group(made) && group(path);

/** Whether two paths differ only in array indices (rule 4: an element before them removed or moved). */
const sameButIndices = (a: Path, b: Path): boolean => a.length === b.length && a.every((seg, i) => (typeof seg === 'number' ? typeof b[i] === 'number' : seg === b[i]));

/** How a message names a path. */
const pathName = (path: Path): string => path.map(String).join('.');

/**
 * `value` as an editing JSON view shows it (rule 3): every whole-key place's text replaced by one note,
 * every private-key block in any other text by a note in place, the rest kept. `under`: the value
 * itself sits under that property. A key that has no note yet gets a new one (`mint`; without it,
 * `complete` says some had none and the key stays as it is).
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
  /** The note for `secret` at `path`: one made there (or in its group), else one made in typed text (bound here now), else a new one. */
  const noteFor = (secret: string, path: Path): string => {
    const place = JSON.stringify(path);
    let free: string | undefined;
    for (const [note, text] of keys) {
      if (text !== secret || used.has(note)) continue;
      const made = at.get(note);
      if (made === place || (made !== undefined && sameGroup(opts.group, JSON.parse(made) as Path, path))) {
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
      // A whole key the caller names (an SSL's) is a note even when empty; a never-shown name's text when it has any.
      if (opts.whole?.(path, key) === true || (byName(path, key) && v !== '')) return noteFor(v, path);
      return holdsPrivateKey(v) ? withoutPrivateKeys(v, (block) => noteFor(block, path)) : v;
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

/** Every note in `value`'s texts: how often each appears, and the paths (JSON) whose text holds one. */
function notesIn(value: unknown): { count: Map<string, number>; at: Set<string> } {
  const count = new Map<string, number>();
  const at = new Set<string>();
  const walk = (v: unknown, path: (string | number)[]) => {
    if (typeof v === 'string') {
      if (!v.includes(MASK.slice(0, 1))) return;
      for (const [note] of v.matchAll(notePattern())) {
        count.set(note, (count.get(note) ?? 0) + 1);
        at.add(JSON.stringify(path));
      }
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...path, i]));
    else if (isObj(v)) for (const [k, x] of Object.entries(v)) walk(x, [...path, k]);
  };
  walk(value, []);
  return { count, at };
}

/**
 * `edited` (an editing JSON view's text, parsed) with every note resolved in place (rule 4), or the
 * problem that holds the text (rule 5). `before` is the value the text was made from: a text it already
 * held is never taken for a damaged note. Text typed around a note is kept as typed.
 */
export function unveilValue(
  edited: unknown,
  notes: KeyNotes,
  opts: { whole?: WholeKey; group?: PlaceGroup; under?: string; before?: unknown } = {},
): { ok: true; value: unknown } | { ok: false; problem: string } {
  // What the value held before, built only when a text looks like a damaged note.
  let keptTexts: Set<string> | undefined;
  const kept = { has: (text: string) => (keptTexts ??= textsOf(opts.before)).has(text) };
  const found = notesIn(edited);
  let problem: string | undefined;
  let changed = false;
  const resolve = (note: string, path: Path): string => {
    const text = notes.keys.get(note);
    const made = notes.at.get(note);
    if (text === undefined) problem ??= t('json.note.unknown');
    else if ((found.count.get(note) ?? 0) > 1) problem ??= t('json.note.twice');
    else if (made !== undefined && made !== JSON.stringify(path)) {
      const own = JSON.parse(made) as Path;
      const moved = !sameGroup(opts.group, own, path) && !(sameButIndices(own, path) && !found.at.has(made));
      if (moved) problem ??= t('json.note.moved', { path: pathName(own) });
    }
    return text ?? note;
  };
  const walk = (v: unknown, path: (string | number)[], key: string | undefined): unknown => {
    if (typeof v === 'string') {
      if (!v.includes(MASK.slice(0, 1)) && !leftOfNote(v, notes.session)) return v;
      const back = v.replace(notePattern(), (note) => resolve(note, path));
      // A note changed by hand no longer matches: what is left of it must not be sent. In a whole-key
      // place any dot left over is (a key has none).
      const damaged = leftOfNote(back, notes.session) || (isWhole(opts.whole, path, key) && back !== v && back.includes(MASK.slice(0, 1)));
      if (damaged && !(back === v && kept.has(v))) problem ??= t('json.note.unknown');
      if (back !== v) changed = true;
      return back;
    }
    if (Array.isArray(v)) return v.map((x, i) => walk(x, [...path, i], key));
    if (isObj(v)) {
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => {
          // A note is a value's stand-in, never a property's name.
          if (k.includes(MASK.slice(0, 1)) && leftOfNote(k, notes.session)) problem ??= t('json.note.unknown');
          return [k, walk(x, [...path, k], k)];
        }),
      );
    }
    return v;
  };
  const out = walk(edited, [], opts.under);
  if (problem !== undefined) return { ok: false, problem };
  return { ok: true, value: changed ? out : edited };
}

/** A string literal of raw JSON text: where it is, its text as written, and the path of the value it is (none for a property name). */
interface Literal {
  start: number;
  end: number;
  raw: string;
  path?: (string | number)[];
}

/**
 * The string literals of raw JSON text, read leniently (text being typed: a literal may hold raw line
 * breaks, the text may end inside one, the structure may be broken), each with the path of the value
 * it is, as far as the text says it.
 */
function literalsOf(text: string): Literal[] {
  type Frame = { kind: 'obj'; key?: string; expectKey: boolean } | { kind: 'arr'; index: number };
  const stack: Frame[] = [];
  const out: Literal[] = [];
  const pathNow = (): (string | number)[] => stack.flatMap((f): (string | number)[] => (f.kind === 'arr' ? [f.index] : f.key !== undefined ? [f.key] : []));
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      const end = Math.min(j + 1, text.length);
      const raw = text.slice(i + 1, Math.min(j, text.length));
      const top = stack.at(-1);
      if (top?.kind === 'obj' && top.expectKey) {
        top.key = decode(raw);
        top.expectKey = false;
        out.push({ start: i, end, raw });
      } else out.push({ start: i, end, raw, path: pathNow() });
      i = end;
      continue;
    }
    if (c === '{') stack.push({ kind: 'obj', expectKey: true });
    else if (c === '[') stack.push({ kind: 'arr', index: 0 });
    else if (c === '}' || c === ']') stack.pop();
    else if (c === ',') {
      const top = stack.at(-1);
      if (top?.kind === 'arr') top.index += 1;
      else if (top) {
        top.expectKey = true;
        top.key = undefined;
      }
    }
    i += 1;
  }
  return out;
}

const ESCAPES: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

/** A string literal's text as JSON means it, read leniently: an escape it can't read stays as written. */
function decode(raw: string): string {
  return raw.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (all, esc: string) => (esc.length === 5 ? String.fromCharCode(parseInt(esc.slice(1), 16)) : (ESCAPES[esc] ?? all)));
}

/** Whole PEM private-key blocks in a text, each from its BEGIN line to its own END line. */
const TYPED_KEY_BLOCKS = /-----BEGIN ([A-Z0-9 ]*)PRIVATE KEY-----[\s\S]*?-----END \1PRIVATE KEY-----/g;

/**
 * Raw text being typed in an editing JSON view, which may not parse, with its key texts veiled (rule 3),
 * for leaving the view: read string by string, so a block never crosses the end of the string it starts
 * in (and an escaped one is seen as what it says); a whole-key place's text that holds a key, or no note,
 * becomes one note; any other string's whole blocks become notes in place; only those strings are
 * rewritten, the rest of the text is left as typed. Such notes are made in typed text: they stand for
 * the user's own keys, bound to where they are first taken. A block with no END line is left as typed.
 */
export function veilTypedText(
  text: string,
  notes: KeyNotes,
  opts: { whole?: WholeKey; under?: string } = {},
): { text: string; notes: KeyNotes; veiled: boolean } {
  if (!opts.whole && !mayHoldKeys(text, notes.session)) return { text, notes, veiled: false };
  const keys = new Map(notes.keys);
  const mint = (secret: string): string => {
    const note = t('json.keyNote', { id: `${notes.session}.${keys.size + 1}` });
    keys.set(note, secret);
    return note;
  };
  let out = '';
  let from = 0;
  for (const literal of literalsOf(text)) {
    if (!literal.path) continue;
    const value = decode(literal.raw);
    const path = literal.path;
    // The property it is under, as the value walks read it (an array's items under the array's name).
    const key = [...path].reverse().find((seg): seg is string => typeof seg === 'string') ?? opts.under;
    let next = value;
    if (isWhole(opts.whole, path, key)) {
      // A whole key place: veiled as a whole when it holds a key, or holds text and no note.
      const hasNote = value.includes(MASK.slice(0, 1)) && notePattern().test(value);
      if (value !== '' && (holdsPrivateKey(value) || !hasNote)) next = mint(value);
    } else if (holdsPrivateKey(value)) next = value.replace(TYPED_KEY_BLOCKS, mint);
    if (next === value) continue;
    out += text.slice(from, literal.start) + JSON.stringify(next);
    from = literal.end;
  }
  if (from === 0) return { text, notes, veiled: false };
  return { text: out + text.slice(from), notes: { session: notes.session, keys, at: notes.at }, veiled: true };
}
