// How a new object's editor starts: from the kind's blank (with any prefill), or from a copy of
// another object, which for a consumer or credential leaves out its sign-in secrets and says so.
import { isObj, stripTimestamps } from '../api/sanitize';
import type { Item, Kind, Obj, PluginInfo } from '../api/types';
import { t } from '../i18n';
import { sharedSignInFields, withoutSignInSecrets } from '../plugins/auth';
import { registry } from '../resources/registry';
import type { CopyNotes } from './CopyNotice';

/** A new object's baseline and starting draft; a copy of a consumer or credential also has its notes (CopyNotice). */
export interface EditorStart {
  baseline: Obj;
  draft: Obj;
  copy?: CopyNotes;
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
  // A copy of a consumer or credential gets no sign-in secret: a key belongs to one of them only.
  if ((kind === 'consumers' || kind === 'credentials') && isObj(copy.plugins)) {
    const { plugins: kept, removed } = withoutSignInSecrets(copy.plugins, plugins);
    const notes: CopyNotes = { removed, shared: sharedSignInFields(kept) };
    return { baseline: source, draft: { ...copy, plugins: kept }, copy: notes };
  }
  return { baseline: source, draft: copy };
}
