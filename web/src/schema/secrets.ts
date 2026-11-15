// What a secret is and how it reads while hidden, shared by the schema form (its secret inputs and
// locked JSON), the plugin cards and the editor's JSON views. Small and free of the form's analysis,
// so the editor frame can mask a locked object without loading the form.
import { isObj } from './refs';

/** What a secret reads as while hidden (the kit's masked input shows the same). */
export const MASK = '••••••••';

const SECRET_KEY = /secret|password|private_key|token/i;
/** Names that contain a secret word but name something else: token_endpoint, client_rsa_private_key_id, … */
const NOT_SECRET_KEY = /(^|_)(url|uri|endpoint|method|expected|id|header|name|field|path|in|alg|type)$/i;

/** Whether a property's name says it holds a secret (client_secret, redis_password, service_token, but not token_endpoint). */
export function isSecretName(key: string): boolean {
  return SECRET_KEY.test(key) && !NOT_SECRET_KEY.test(key);
}

/** The object keys of a dotted field path, array indices left out (as APISIX's encrypt_fields write paths). */
export const keyPath = (path: string): string[] => (path === '' ? [] : path.split('.').filter((seg) => !/^\d+$/.test(seg)));

/** What `atEncryptPath`'s `leaf` returns to remove the value it was given. */
export const REMOVE: unique symbol = Symbol('remove');

/**
 * `conf` with `leaf` applied to the value an `encrypt_fields` path names, walked as APISIX walks it
 * (process_encrypt_field, apisix/plugin.lua 1116–1190): the path is dotted; an array met on the way
 * is walked element by element; whatever sits at the end goes to `leaf` (APISIX itself encrypts a
 * string there, each string of a list, or each string of a map). `leaf` returns the new value, or
 * REMOVE to delete the key. Nothing is changed where the path leads nowhere. The one walk shared by
 * the masking below, a copy's cleared sign-in secrets (plugins/auth.ts) and the fake Admin API's
 * encryption (test/fakeAdmin.ts).
 */
export function atEncryptPath(conf: unknown, path: readonly string[], leaf: (value: unknown) => unknown): unknown {
  const [head, ...rest] = path;
  if (head === undefined) return conf;
  if (Array.isArray(conf)) return conf.map((item) => atEncryptPath(item, path, leaf));
  if (!isObj(conf) || conf[head] === undefined) return conf;
  const next = rest.length > 0 ? atEncryptPath(conf[head], rest, leaf) : leaf(conf[head]);
  if (next === REMOVE) {
    const out = { ...conf };
    delete out[head];
    return out;
  }
  return next === conf[head] ? conf : { ...conf, [head]: next };
}

/** Every string at any depth in `value` masked. */
function maskStrings(value: unknown): unknown {
  if (typeof value === 'string') return MASK;
  if (Array.isArray(value)) return value.map(maskStrings);
  return isObj(value) ? Object.fromEntries(Object.entries(value).map(([k, x]) => [k, maskStrings(x)])) : value;
}

/**
 * `value` (shown at the field `path`) with every secret string masked: those an encrypt path names
 * (atEncryptPath; all of a map or object there, a map of headers say) or that lie below one, and those
 * under a key whose name says secret, at any depth from the field's own key down. `redacted` says
 * whether anything was.
 */
export function redactSecrets(value: unknown, path: string, encrypt: string[]): { value: unknown; redacted: boolean } {
  const keys = keyPath(path);
  let out = value;
  for (const e of encrypt) {
    const segments = e.split('.');
    // The value lies at or below this encrypt path: all of it is secret.
    if (segments.length <= keys.length && segments.every((s, i) => keys[i] === s)) out = maskStrings(out);
    // The path leads into the value: mask what it names.
    else if (keys.every((k, i) => segments[i] === k)) out = atEncryptPath(out, segments.slice(keys.length), maskStrings);
  }
  const walk = (v: unknown, secret: boolean): unknown => {
    if (typeof v === 'string') return secret ? MASK : v;
    if (Array.isArray(v)) return v.map((x) => walk(x, secret));
    if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, secret || isSecretName(k))]));
    return v;
  };
  const own = keys.at(-1);
  out = walk(out, own !== undefined && isSecretName(own));
  return { value: out, redacted: JSON.stringify(out) !== JSON.stringify(value) };
}

/** The first line of a PEM private key of any form (PKCS#8, PKCS#1 RSA, SEC1 EC, DSA, encrypted). */
const KEY_BEGIN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;

/** Every PEM private-key block in a text, to its END line (or to the end of the text when that is missing). */
const KEY_BLOCKS = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g;

/** Whether `text` holds a PEM private key anywhere (a combined certificate + key file does). */
export const holdsPrivateKey = (text: unknown): boolean => typeof text === 'string' && KEY_BEGIN.test(text);

/** `text` with each PEM private-key block replaced by `by` (or what it returns for the block); the rest, certificates included, kept. */
export const withoutPrivateKeys = (text: string, by: string | ((block: string) => string)): string =>
  typeof by === 'string' ? text.replace(KEY_BLOCKS, () => by) : text.replace(KEY_BLOCKS, by);
