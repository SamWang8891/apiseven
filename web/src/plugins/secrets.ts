// A whole stored object with its secrets masked, for the views that show it as JSON while it is not
// being edited (the editor's locked JSON tab, View JSON) and for the conflict diff. Per kind:
// - every kind: any key named like a secret (isSecretName: password, token, secret, private_key …),
//   at any depth;
// - every plugin-bearing kind: each plugin's `encrypt_fields` (APISIX stores them encrypted and its
//   GET returns them in clear), read from the schema the kind's scope uses (a consumer's and a
//   credential's auth plugins: their consumer schema); every value of a plugin the list doesn't
//   know (removed, or a custom one not loaded) or while the list loads: which are secret is unknown;
// - plugin metadata: its plugin's metadata `encrypt_fields` (azure-functions' master_apikey); every
//   value but the id while the plugin's metadata schema is not known (the list loads, the plugin is
//   not loaded or has none);
// - a secret manager entry: its manager's credentials (secrets/schemas.ts SECRET_FIELDS: a vault
//   token, AWS keys, a GCP private key); every value but the id for a manager it doesn't know;
// - any `client_key` (an upstream's or an inline upstream's tls.client_key, which a GET returns as
//   APISIX's AES ciphertext; traffic-split's, which it returns as stored) and every PEM private-key
//   block in any text, whatever field it is in (final wave fix round 1, R1: schema/secrets.ts
//   hideNeverShown) are never shown, not even on "Show secrets"; the editing JSON views show a note in
//   their place (veilKeys, schema/keyNotes.ts);
// - an SSL's private keys, `key` and each of `keys`: a GET never returns them (admin/resource.lua
//   180–193), but a new one sits in the draft from Replace until the save, so they are never shown
//   either; the editing JSON tab shows a note in their place (veilKeys).
import { isObj } from '../api/sanitize';
import type { Kind, Obj, PluginInfo } from '../api/types';
import { unveilValue, veilTypedText, veilValue, type KeyNotes, type PlaceGroup, type WholeKey } from '../schema/keyNotes';
import { hideNeverShown, holdsPrivateKey, MASK, redactSecrets, withoutPrivateKeys } from '../schema/secrets';
import { schemaFor, scopeOfKind } from './scope';
import { managerOf, SCHEMAS, SECRET_FIELDS } from '../resources/secrets/schemas';

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

/** A plugin metadata (or a secret manager entry) with every value but its id masked: which are secret is not known. */
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
      const schema = info && scope ? schemaFor(info, scope) : undefined;
      const masked = schema ? redactSecrets(conf, '', encryptOf(schema), schema) : maskConfig(conf);
      redacted ||= masked.redacted;
      return [name, masked.value];
    }),
  );
  return { value, redacted };
}

/**
 * `value` with its secrets masked (see the head comment). `all` is the plugin list of the kind's
 * scope (the stream set for a stream route); while it is undefined (loading), which plugin fields are
 * secret is not known, so every text inside `plugins` is masked. `id` is the object's id as the
 * caller knows it (the page's, the row's): what a plugin metadata entry or a secret manager entry is
 * told by when its body has no `id` of its own; with neither, every value is masked.
 */
export function redactObject(value: Obj, kind: Kind, all: Record<string, PluginInfo> | undefined, id?: string): Redacted {
  const ownId = typeof value.id === 'string' ? value.id : id;
  // Never shown, not even on "Show secrets": a never-shown name's text (client_key) and every PEM
  // private-key block in any text (hideNeverShown), and an SSL's own keys.
  const clientKeys = hideNeverShown(value);
  const never = kind === 'ssls' ? maskSslKeys(clientKeys.value as Obj) : { value: clientKeys.value as Obj, redacted: false };
  never.redacted ||= clientKeys.hidden;
  const revealed = never.redacted ? never.value : value;
  // By name: everything but what a schema-aware pass below reads (each plugin's config; a metadata
  // entry or a secret manager entry whose schema is known), where a number its schema types as one is
  // not a secret for its name alone.
  const pluginsApart = scopeOfKind[kind] !== undefined && isObj(revealed.plugins);
  const manager = kind === 'secrets' ? managerOf(ownId) : undefined;
  const ownSchema = kind === 'plugin_metadata' ? (ownId === undefined ? undefined : all?.[ownId]?.metadata_schema) : manager ? SCHEMAS[manager] : undefined;
  const others = pluginsApart ? Object.fromEntries(Object.entries(revealed).filter(([key]) => key !== 'plugins')) : revealed;
  const named = redactSecrets(others, '', [], ownSchema).value as Obj;
  // The keys in their order, the plugins left to maskPlugins.
  const byNameValue = pluginsApart ? Object.fromEntries(Object.entries(revealed).map(([key, v]) => [key, key === 'plugins' ? v : named[key]])) : named;
  const byName = { value: byNameValue, redacted: JSON.stringify(byNameValue) !== JSON.stringify(revealed) };
  let masked = byName.value;
  let secrets = byName.redacted;
  if (scopeOfKind[kind] && isObj(masked.plugins)) {
    const plugins = maskPlugins(masked.plugins, kind, all);
    if (plugins.redacted) masked = { ...masked, plugins: plugins.value };
    secrets ||= plugins.redacted;
  }
  if (kind === 'plugin_metadata') {
    const schema = ownId === undefined ? undefined : all?.[ownId]?.metadata_schema;
    const meta = schema ? redactSecrets(masked, '', encryptOf(schema), schema) : maskMetadata(masked);
    masked = meta.value as Obj;
    secrets ||= meta.redacted;
  }
  if (kind === 'secrets') {
    const own = manager ? redactSecrets(masked, '', SECRET_FIELDS[manager], SCHEMAS[manager]) : maskMetadata(masked);
    masked = own.value as Obj;
    secrets ||= own.redacted;
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
  id?: string,
): { masked: [Obj, Obj]; revealed: [Obj, Obj]; redacted: boolean; revealable: boolean } {
  const l = redactObject(loaded, kind, all, id);
  const r = redactObject(theirs, kind, all, id);
  const marked = (shown: unknown, real: unknown, other: unknown): unknown => {
    if (shown === MASK && (typeof real === 'string' || typeof real === 'number')) return real === other ? MASK : MASK_CHANGED;
    // A text masked in place (a private-key block in it): changed when the real texts differ.
    if (typeof shown === 'string' && typeof real === 'string' && shown !== real && real !== other) return `${shown} ${MASK_CHANGED.slice(MASK.length + 1)}`;
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

export type { KeyNotes } from '../schema/keyNotes';
export { newKeyNotes } from '../schema/keyNotes';

/** An SSL's private keys, whole: its `key` and each of its `keys` (a GET never returns them; a new one sits in the draft from Replace). */
const sslKeys: WholeKey = (path) => (path.length === 1 && path[0] === 'key') || (path.length === 2 && path[0] === 'keys');

/** An SSL's key and certificate slots (`key`, `keys[i]`, `cert`, `certs[i]`, `client.ca`): a note made in one may move to another (the user swaps pairs). */
const sslSlots: PlaceGroup = (path) =>
  sslKeys(path, undefined) || (path.length === 1 && path[0] === 'cert') || (path.length === 2 && path[0] === 'certs') || (path.length === 2 && path[0] === 'client' && path[1] === 'ca');

const wholeFor = (kind: Kind): { whole?: WholeKey; group?: PlaceGroup } => (kind === 'ssls' ? { whole: sslKeys, group: sslSlots } : {});

/**
 * The draft as the editing JSON tab shows it (schema/keyNotes.ts veilValue): every value that is never
 * shown as a note: a PEM private-key block in any text, in place; a never-shown name's text (client_key)
 * whole; an SSL's `key` and each of its `keys` whole. A key that has no note yet gets a new one (`mint`;
 * without it, `complete` says some had none).
 */
export function veilKeys(kind: Kind, draft: Obj, notes: KeyNotes, mint = true): { value: Obj; notes: KeyNotes; veiled: boolean; complete: boolean } {
  const veiled = veilValue(draft, notes, { mint, ...wholeFor(kind) });
  return { ...veiled, value: veiled.value as Obj };
}

/**
 * `edited` (the JSON tab's text, parsed) with each note turned back into the key it was made for, where
 * it may stand (schema/keyNotes.ts unveilValue, rule 4: an SSL's notes anywhere among its key and
 * certificate slots). Refused (`problem`, the text then holds Save as unfinished input) when a note
 * stands for no key of this session, is used twice, is out of place, or is left damaged; `before` is
 * the draft the text was made from. Text typed around a note is kept as typed.
 */
export function unveilKeys(kind: Kind, edited: Obj, notes: KeyNotes, before?: Obj): { ok: true; value: Obj } | { ok: false; problem: string } {
  const back = unveilValue(edited, notes, { ...wholeFor(kind), before });
  return back.ok ? { ok: true, value: back.value as Obj } : back;
}

/** The editing JSON tab's raw text with its key texts veiled, for leaving the tab (schema/keyNotes.ts veilTypedText; an SSL's `key` and `keys` whole). */
export function veilTypedKeys(kind: Kind, text: string, notes: KeyNotes): { text: string; notes: KeyNotes; veiled: boolean } {
  return veilTypedText(text, notes, { whole: wholeFor(kind).whole });
}

/** Whether copied text leaves a private key out: it shows a note and holds no private key itself. */
export const copiedWithoutKey = (text: string): boolean => text.includes(MASK) && !holdsPrivateKey(text);
