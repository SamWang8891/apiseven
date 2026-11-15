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

/**
 * `value` (shown at the field `path`) with every secret string masked: those at an encrypt path or
 * below one (a map of headers), and those under a key whose name says secret, at any depth from the
 * field's own key down. `redacted` says whether anything was.
 */
export function redactSecrets(value: unknown, path: string, encrypt: string[]): { value: unknown; redacted: boolean } {
  let redacted = false;
  const encrypted = (keys: string[]) => {
    const joined = keys.join('.');
    return encrypt.some((e) => joined === e || joined.startsWith(`${e}.`));
  };
  const walk = (v: unknown, keys: string[], secret: boolean): unknown => {
    if (typeof v === 'string') {
      if (!secret && !encrypted(keys)) return v;
      redacted = true;
      return MASK;
    }
    if (Array.isArray(v)) return v.map((x) => walk(x, keys, secret));
    if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, [...keys, k], secret || isSecretName(k))]));
    return v;
  };
  const keys = keyPath(path);
  const own = keys.at(-1);
  const out = walk(value, keys, own !== undefined && isSecretName(own));
  return { value: out, redacted };
}
