// A whole stored object with its secrets masked, for the views that show it as JSON while it is not
// being edited (the editor's locked JSON tab, View JSON) and for the conflict diff. Per kind:
// - every kind: any key named like a secret (isSecretName: password, token, secret, private_key …),
//   at any depth;
// - every plugin-bearing kind: each plugin's `encrypt_fields` (APISIX stores them encrypted and its
//   GET returns them in clear), read from the schema the kind's scope uses (a consumer's and a
//   credential's auth plugins: their consumer schema); every value of a plugin the list doesn't
//   know (removed, or a custom one not loaded) or while the list loads: which are secret is unknown;
// - plugin metadata: its plugin's metadata `encrypt_fields` (azure-functions' master_apikey);
// - any `client_key` (an upstream's or an inline upstream's tls.client_key, which a GET returns as
//   APISIX's AES ciphertext) is never shown, not even on "Show secrets";
// - an SSL's private keys, `key` and each of `keys`: a GET never returns them (admin/resource.lua
//   180–193), but a new one sits in the draft from Replace until the save, so they are never shown
//   either; the editing JSON tab shows a note in their place (veilKeys).
import { isObj } from '../api/sanitize';
import type { Kind, Obj, PluginInfo } from '../api/types';
import { t } from '../i18n';
import { holdsPrivateKey, MASK, redactSecrets, withoutPrivateKeys } from '../schema/secrets';
import { schemaFor, scopeOfKind } from './scope';

/** Keys whose value no view shows (see the head comment). */
const NEVER_SHOWN = new Set(['client_key']);

export interface Redacted {
  /** Every secret masked. */
  value: Obj;
  /** What "Show secrets" shows: only the never-shown keys masked. */
  revealed: Obj;
  /** Whether `value` masks anything. */
  redacted: boolean;
  /** Whether "Show secrets" would show more (something other than a never-shown key is masked). */
  revealable: boolean;
}

/**
 * An SSL's top-level `key` and every text of `keys` masked, and a private-key block inside `cert`, an
 * entry of `certs` or `client.ca` (an SSL stored with a combined certificate + key file, which APISIX
 * keeps in clear and returns) masked in place, its certificates kept: all never shown.
 */
function maskSslKeys(value: Obj): { value: Obj; redacted: boolean } {
  let redacted = false;
  const out: Obj = { ...value };
  const hide = (v: unknown): unknown => {
    if (typeof v !== 'string') return v;
    redacted = true;
    return MASK;
  };
  const hideBlocks = (v: unknown): unknown => {
    if (!holdsPrivateKey(v)) return v;
    redacted = true;
    return withoutPrivateKeys(v as string, MASK);
  };
  if (out.key !== undefined) out.key = hide(out.key);
  if (Array.isArray(out.keys)) out.keys = (out.keys as unknown[]).map(hide);
  out.cert = hideBlocks(out.cert);
  if (out.cert === undefined) delete out.cert;
  if (Array.isArray(out.certs)) out.certs = (out.certs as unknown[]).map(hideBlocks);
  if (isObj(out.client) && holdsPrivateKey(out.client.ca)) out.client = { ...out.client, ca: hideBlocks(out.client.ca) };
  return { value: out, redacted };
}

/** The schema's own top-level encrypt_fields. */
function encryptOf(schema: Obj | undefined): string[] {
  const list: unknown = schema?.encrypt_fields;
  return Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string') : [];
}

/** `value` with every string `masks(keys)` says is secret replaced by MASK. */
function mask(value: unknown, masks: (key: string) => boolean): { value: unknown; redacted: boolean } {
  let redacted = false;
  const walk = (v: unknown, secret: boolean): unknown => {
    if (typeof v === 'string') {
      if (!secret) return v;
      redacted = true;
      return MASK;
    }
    if (Array.isArray(v)) return v.map((x) => walk(x, secret));
    return isObj(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, secret || masks(k))])) : v;
  };
  const out = walk(value, false);
  return { value: out, redacted };
}

/**
 * Every value in a plugin config masked, scalars of every type (a key may be a number), for a plugin
 * whose secret fields are not known. Still revealable.
 */
export function maskConfig(conf: unknown): { value: unknown; redacted: boolean } {
  let redacted = false;
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    if (v === null || v === undefined) return v;
    redacted = true;
    return MASK;
  };
  const value = walk(conf);
  return { value, redacted };
}

/** A plugin metadata with every value but its id masked (its plugin's secret fields not known yet). */
function maskMetadata(value: Obj): { value: unknown; redacted: boolean } {
  const { id, ...rest } = value;
  const masked = maskConfig(rest);
  return { value: { id, ...(masked.value as Obj) }, redacted: masked.redacted };
}

/** Each plugin's config with its secrets masked; all of it for a plugin not in the list, or while the list (`all`) loads. */
function maskPlugins(plugins: Obj, kind: Kind, all: Record<string, PluginInfo> | undefined): { value: Obj; redacted: boolean } {
  const scope = scopeOfKind[kind];
  let redacted = false;
  const value = Object.fromEntries(
    Object.entries(plugins).map(([name, conf]) => {
      const info = all?.[name];
      const masked = info && scope ? redactSecrets(conf, '', encryptOf(schemaFor(info, scope))) : maskConfig(conf);
      redacted ||= masked.redacted;
      return [name, masked.value];
    }),
  );
  return { value, redacted };
}

/**
 * `value` with its secrets masked (see the head comment). `all` is the plugin list of the kind's
 * scope (the stream set for a stream route); while it is undefined (loading), which plugin fields are
 * secret is not known, so every text inside `plugins` is masked.
 */
export function redactObject(value: Obj, kind: Kind, all: Record<string, PluginInfo> | undefined): Redacted {
  const clientKeys = mask(value, (k) => NEVER_SHOWN.has(k));
  const never = kind === 'ssls' ? maskSslKeys(clientKeys.value as Obj) : { value: clientKeys.value as Obj, redacted: false };
  never.redacted ||= clientKeys.redacted;
  const revealed = never.redacted ? never.value : value;
  const byName = redactSecrets(revealed, '', []);
  let masked = byName.value as Obj;
  let secrets = byName.redacted;
  if (scopeOfKind[kind] && isObj(masked.plugins)) {
    const plugins = maskPlugins(masked.plugins, kind, all);
    if (plugins.redacted) masked = { ...masked, plugins: plugins.value };
    secrets ||= plugins.redacted;
  }
  if (kind === 'plugin_metadata' && typeof value.id === 'string') {
    const encrypt = all ? encryptOf(all[value.id]?.metadata_schema) : undefined;
    const meta = encrypt ? redactSecrets(masked, '', encrypt) : maskMetadata(masked);
    masked = meta.value as Obj;
    secrets ||= meta.redacted;
  }
  return secrets || never.redacted ? { value: masked, revealed, redacted: true, revealable: secrets } : { value, revealed: value, redacted: false, revealable: false };
}

/**
 * What a copy of the shown text left out, for its toast: 'masked' when Show secrets would change what
 * is copied, 'neverShown' when only never-shown keys (client_key) are masked, else undefined.
 */
export function copiedWithout(hidden: Redacted | undefined, revealed: boolean): 'masked' | 'neverShown' | undefined {
  if (!hidden?.redacted) return undefined;
  if (hidden.revealable && !revealed) return 'masked';
  // Revealed, or nothing to reveal: the copy is `revealed`, which masks only the never-shown keys.
  return JSON.stringify(hidden.revealed).includes(MASK) ? 'neverShown' : undefined;
}

/** What a masked secret reads as in a diff when the two sides hold different values. */
export const MASK_CHANGED = `${MASK} (changed)`;

/**
 * Both sides of a comparison (the conflict diff) masked like redactObject, the masked view and the
 * revealed one. A masked value whose real value differs from the other side's at the same place
 * reads MASK_CHANGED on `theirs`, so the line still shows as changed without showing either value.
 */
export function redactPair(
  loaded: Obj,
  theirs: Obj,
  kind: Kind,
  all: Record<string, PluginInfo> | undefined,
): { masked: [Obj, Obj]; revealed: [Obj, Obj]; redacted: boolean; revealable: boolean } {
  const l = redactObject(loaded, kind, all);
  const r = redactObject(theirs, kind, all);
  const marked = (shown: unknown, real: unknown, other: unknown): unknown => {
    if (shown === MASK && typeof real === 'string') return real === other ? MASK : MASK_CHANGED;
    if (Array.isArray(shown) && Array.isArray(real)) return shown.map((s, i) => marked(s, real[i], Array.isArray(other) ? other[i] : undefined));
    if (isObj(shown) && isObj(real)) return Object.fromEntries(Object.entries(shown).map(([k, s]) => [k, marked(s, real[k], isObj(other) ? other[k] : undefined)]));
    return shown;
  };
  return {
    masked: [l.value, marked(r.value, theirs, loaded) as Obj],
    revealed: [l.revealed, marked(r.revealed, theirs, loaded) as Obj],
    redacted: l.redacted || r.redacted,
    revealable: l.revealable || r.revealable,
  };
}

/**
 * The notes the editing JSON tab shows in place of private keys: each note is a token for one key text,
 * made in one editing session (`session`, unique on the page) and never reused, so a note resolves to
 * the key it was made for or to nothing: never to another key by its position, never to itself.
 */
export interface KeyNotes {
  readonly session: number;
  /** note text → the key text it stands for */
  readonly keys: ReadonlyMap<string, string>;
}

let sessions = 0;

/** A new, empty set of notes for an editing session. */
export function newKeyNotes(): KeyNotes {
  sessions += 1;
  return { session: sessions, keys: new Map() };
}

/** The slots of an SSL that hold a private key: `key` and each of `keys` whole; a key block inside `cert`, an entry of `certs`, `client.ca`. */
interface Slot {
  /** The whole text is a key (`key`, `keys`), else keys are blocks inside it (`cert`, `certs`, `client.ca`). */
  whole: boolean;
  get: (o: Obj) => unknown;
  set: (o: Obj, v: unknown) => Obj;
}

function slotsOf(value: Obj): Slot[] {
  const slots: Slot[] = [];
  if (value.key !== undefined) slots.push({ whole: true, get: (o) => o.key, set: (o, v) => ({ ...o, key: v }) });
  const list = (name: 'keys' | 'certs', whole: boolean) => {
    const items = value[name];
    if (!Array.isArray(items)) return;
    items.forEach((_, i) => {
      const at = (o: Obj): unknown[] => (Array.isArray(o[name]) ? (o[name] as unknown[]) : []);
      slots.push({ whole, get: (o) => at(o)[i], set: (o, v) => ({ ...o, [name]: at(o).map((x, j) => (j === i ? v : x)) }) });
    });
  };
  list('keys', true);
  if (value.cert !== undefined) slots.push({ whole: false, get: (o) => o.cert, set: (o, v) => ({ ...o, cert: v }) });
  list('certs', false);
  if (isObj(value.client) && value.client.ca !== undefined) {
    slots.push({ whole: false, get: (o) => (isObj(o.client) ? o.client.ca : undefined), set: (o, v) => ({ ...o, client: { ...(isObj(o.client) ? o.client : {}), ca: v } }) });
  }
  return slots;
}

/** What the editing JSON tab shows for a private key's text, or a note made in another session. */
const notePattern = (): RegExp => new RegExp(t('json.keyNote', { id: '\u0000' }).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\u0000', '[0-9.]+'), 'g');

/**
 * The draft as the editing JSON tab shows it: an SSL's private keys (`key`, each of `keys`) and any
 * private-key block stored inside `cert`, `certs` or `client.ca` replaced by its note. A key that has
 * no note yet gets a new one (`mint`; without it, `complete` says some had none). Every other kind, and
 * an SSL without such text, as it is.
 */
export function veilKeys(kind: Kind, draft: Obj, notes: KeyNotes, mint = true): { value: Obj; notes: KeyNotes; veiled: boolean; complete: boolean } {
  if (kind !== 'ssls') return { value: draft, notes, veiled: false, complete: true };
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
  let value = draft;
  for (const slot of slotsOf(draft)) {
    const text = slot.get(draft);
    if (typeof text !== 'string') continue;
    if (slot.whole) value = slot.set(value, noteFor(text));
    else if (holdsPrivateKey(text)) value = slot.set(value, withoutPrivateKeys(text, noteFor));
  }
  return { value, notes: keys.size === notes.keys.size ? notes : { session: notes.session, keys }, veiled: used.size > 0, complete };
}

/**
 * `edited` (the JSON tab's text, parsed) with each note turned back into the key it was made for,
 * wherever it now is. Refused (`problem`, the text then holds Save as unfinished input) when a note
 * stands for no key of this session (changed by hand, pasted from elsewhere, left from an earlier
 * session) or is used twice (each stands for one key): a note's text never reaches the draft, so it is
 * never sent as a key, whatever its length and the SSL's type. Text typed over a note is kept as typed.
 */
export function unveilKeys(kind: Kind, edited: Obj, notes: KeyNotes): { ok: true; value: Obj } | { ok: false; problem: string } {
  if (kind !== 'ssls') return { ok: true, value: edited };
  const seen = new Set<string>();
  let problem: string | undefined;
  const resolve = (note: string): string => {
    const text = notes.keys.get(note);
    if (text === undefined) problem ??= t('json.note.unknown');
    else if (seen.has(note)) problem ??= t('json.note.twice');
    seen.add(note);
    return text ?? note;
  };
  let value = edited;
  for (const slot of slotsOf(edited)) {
    const text = slot.get(edited);
    if (typeof text !== 'string' || !text.includes(MASK.slice(0, 1))) continue;
    if (slot.whole) {
      value = slot.set(value, resolve(text));
      continue;
    }
    const back = text.replace(notePattern(), resolve);
    // A note changed by hand no longer matches: what is left of it must not be sent.
    if (back.includes(MASK.slice(0, 1))) problem ??= t('json.note.unknown');
    value = slot.set(value, back);
  }
  return problem === undefined ? { ok: true, value } : { ok: false, problem };
}

/** Whether copied text leaves a private key out: it shows a note and holds no private key itself. */
export const copiedWithoutKey = (text: string): boolean => text.includes(MASK) && !holdsPrivateKey(text);
