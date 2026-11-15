// A whole stored object with its secrets masked, for the views that show it as JSON while it is not
// being edited (the editor's locked JSON tab, View JSON). Plugin configs carry the secrets: an auth
// plugin's key or password (its `encrypt_fields`, which APISIX stores encrypted and the Admin API
// GET returns in clear text), and any field named like a secret.
import { isObj } from '../api/sanitize';
import type { Kind, Obj, PluginInfo } from '../api/types';
import { MASK, redactSecrets } from '../schema/secrets';
import { schemaFor, scopeOfKind } from './scope';

/** The schema's own top-level encrypt_fields. */
function encryptOf(schema: Obj): string[] {
  const list: unknown = schema.encrypt_fields;
  return Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string') : [];
}

/** Every string in `value` masked. */
function maskAll(value: unknown): { value: unknown; redacted: boolean } {
  let redacted = false;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      redacted = true;
      return MASK;
    }
    if (Array.isArray(v)) return v.map(walk);
    return isObj(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : v;
  };
  const out = walk(value);
  return { value: out, redacted };
}

/**
 * `value` with every secret masked: keys named like a secret anywhere, and each plugin's
 * `encrypt_fields`, read from the schema the kind's scope checks it with (a consumer's and a
 * credential's auth plugins use their consumer schema). `all` is the scope's plugin list; while it is
 * undefined (loading), which fields are secret is not known, so every text inside `plugins` is masked.
 */
export function redactObject(value: Obj, kind: Kind, all: Record<string, PluginInfo> | undefined): { value: Obj; redacted: boolean } {
  const byName = redactSecrets(value, '', []);
  let redacted = byName.redacted;
  const out = byName.value as Obj;
  const scope = scopeOfKind[kind];
  if (!scope || !isObj(out.plugins)) return { value: redacted ? out : value, redacted };

  const plugins = Object.fromEntries(
    Object.entries(out.plugins).map(([name, conf]) => {
      const info = all?.[name];
      const masked = all ? redactSecrets(conf, '', info ? encryptOf(schemaFor(info, scope)) : []) : maskAll(conf);
      redacted ||= masked.redacted;
      return [name, masked.value];
    }),
  );
  return redacted ? { value: { ...out, plugins }, redacted } : { value, redacted };
}
