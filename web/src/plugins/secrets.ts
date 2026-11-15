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
//   APISIX's AES ciphertext) is never shown, not even on "Show secrets".
import { isObj } from '../api/sanitize';
import type { Kind, Obj, PluginInfo } from '../api/types';
import { MASK, redactSecrets } from '../schema/secrets';
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
  const never = mask(value, (k) => NEVER_SHOWN.has(k));
  const revealed = never.redacted ? (never.value as Obj) : value;
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
