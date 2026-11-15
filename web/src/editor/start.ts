// How a new object's editor starts: from the kind's blank (with any prefill), or from a copy of
// another object, which for a consumer or credential leaves out its sign-in secrets and says so.
import { isObj, stripTimestamps } from '../api/sanitize';
import type { Item, Kind, Obj, PluginInfo } from '../api/types';
import { t } from '../i18n';
import { sharedSignInFields, withoutSignInSecrets } from '../plugins/auth';
import { registry } from '../resources/registry';
import { servedToClients } from '../resources/resolve';
import { sniNames } from '../resources/ssls/usage';
import { holdsPrivateKey, withoutPrivateKeys } from '../schema/secrets';
import type { CopyNotes } from './CopyNotice';

/** A new object's baseline and starting draft; a copy of a consumer or credential also has its notes (CopyNotice). */
export interface EditorStart {
  baseline: Obj;
  draft: Obj;
  copy?: CopyNotes;
}

/**
 * A copy of an SSL: what a GET gave (never a key), with any private key stored inside the certificate
 * texts left out, and notes on the keys to enter and the SNIs still shared with the original, which
 * APISIX presents for them while it was loaded first (the router keeps one certificate per SNI).
 */
function sslCopy(source: Obj, copy: Obj): EditorStart {
  let keyInCert = false;
  const clean = (text: unknown): unknown => {
    if (!holdsPrivateKey(text)) return text;
    keyInCert = true;
    return withoutPrivateKeys(text as string, '').replace(/\n{2,}/g, '\n').replace(/^\s+/, '');
  };
  if (copy.cert !== undefined) copy.cert = clean(copy.cert);
  if (Array.isArray(copy.certs)) copy.certs = (copy.certs as unknown[]).map(clean);
  if (isObj(copy.client) && copy.client.ca !== undefined) copy.client = { ...copy.client, ca: clean(copy.client.ca) };
  const extraKeys = Array.isArray(source.certs) ? source.certs.length : 0;
  const snis = servedToClients(source) ? sniNames(source) : [];
  return { baseline: source, draft: copy, copy: { removed: [], shared: [], ssl: { extraKeys, snis, keyInCert } } };
}

/**
 * A new object's baseline (what "unchanged" means) and its starting draft; for a copy of a consumer
 * or credential, what of its plugins was left out and which lookup fields it still shares with the
 * original (CopyNotes). `plugins` is the plugin list, null when it could not load
 * (withoutSignInSecrets then fails closed).
 */
export function startOf(kind: Kind, duplicateFrom: Item | undefined, initial: Obj | undefined, plugins: Record<string, PluginInfo> | null): EditorStart {
  if (!duplicateFrom) {
    const blank = { ...registry[kind].blank(), ...initial };
    return { baseline: blank, draft: blank };
  }
  const source = stripTimestamps(duplicateFrom.value);
  const copy: Obj = { ...source };
  delete copy.id;
  if (kind === 'consumers') delete copy.username;
  if (typeof copy.name === 'string' && copy.name !== '') copy.name = t('editor.copyName', { name: copy.name });
  if (kind === 'ssls') return sslCopy(source, copy);
  // A copy of a consumer or credential gets no sign-in secret: a key belongs to one of them only.
  if ((kind === 'consumers' || kind === 'credentials') && isObj(copy.plugins)) {
    const { plugins: kept, removed } = withoutSignInSecrets(copy.plugins, plugins);
    const notes: CopyNotes = { removed, shared: sharedSignInFields(kept) };
    return { baseline: source, draft: { ...copy, plugins: kept }, copy: notes };
  }
  return { baseline: source, draft: copy };
}
