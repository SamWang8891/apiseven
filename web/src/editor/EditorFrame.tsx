// The page every resource is viewed and edited in: a stored object is loaded (with its loading,
// not-found and failed states), a new one starts from the kind's blank or a copy, and Editor.tsx
// does the rest. Tabs come from the registry, plus the frame's own JSON tab (id JSON_TAB in json.ts).
import { useMemo, useState, type FC } from 'react';
import { useAllPlugins, useItem } from '../api/hooks';
import { isObj, stripTimestamps } from '../api/sanitize';
import type { Item, Kind, Obj, Parent, PluginInfo } from '../api/types';
import { withoutSignInSecrets, type RemovedSecret } from '../plugins/auth';
import { t } from '../i18n';
import { registry } from '../resources/registry';
import { Editor } from './Editor';
import { EditorSkeleton, LoadErrorState, NotFoundState } from './states';
import './editor.css';

export interface EditorFrameProps {
  kind: Kind;
  /** A stored object to load; undefined to create one. */
  id?: string;
  parent?: Parent;
  /** Create a copy of this item: its value without the id, timestamps and (consumers) username, " copy" added to the name. */
  duplicateFrom?: Item;
  /** For a new object: merged over registry[kind].blank(). */
  initial?: Obj;
}

/**
 * A new object's baseline (what "unchanged" means) and its starting draft; for a copy of a consumer
 * or credential, what of its plugins was left out. `plugins` is the plugin list, null when it could
 * not load (withoutSignInSecrets then fails closed).
 */
function startOf(kind: Kind, duplicateFrom: Item | undefined, initial: Obj | undefined, plugins: Record<string, PluginInfo> | null): { baseline: Obj; draft: Obj; removed?: RemovedSecret[] } {
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
    return { baseline: source, draft: { ...copy, plugins: kept }, removed };
  }
  return { baseline: source, draft: copy };
}

export const EditorFrame: FC<EditorFrameProps> = ({ kind, id, parent, duplicateFrom, initial }) =>
  id === undefined ? <NewEditor kind={kind} parent={parent} duplicateFrom={duplicateFrom} initial={initial} /> : <StoredEditor kind={kind} id={id} parent={parent} />;

/**
 * A new object or a copy. A copy of a consumer or credential is built only once the plugin list has
 * loaded (which plugins sign in, and with which fields, is in it), or failed to (it then fails closed):
 * never from a list still loading, so no secret reaches the copy's draft meanwhile.
 */
function NewEditor({ kind, parent, duplicateFrom, initial }: { kind: Kind; parent?: Parent; duplicateFrom?: Item; initial?: Obj }) {
  const list = useAllPlugins();
  const signIn = duplicateFrom !== undefined && (kind === 'consumers' || kind === 'credentials');
  // The list as it first settled: the copy is built once from it. (A failed list is fetched again
  // when the editor mounts its own observer, and pending again meanwhile: following that would loop.)
  const [settled, setSettled] = useState<{ plugins: Record<string, PluginInfo> | null }>();
  if (!settled && (list.data || list.isError)) setSettled({ plugins: list.data ?? null });
  const start = useMemo(() => (settled || !signIn ? startOf(kind, duplicateFrom, initial, settled?.plugins ?? null) : undefined), [settled, signIn, kind, duplicateFrom, initial]);
  if (!start) return <EditorSkeleton kind={kind} />;
  return <Editor kind={kind} parent={parent} start={start} copyOf={duplicateFrom} />;
}

/** Loads the object, then edits it; the loading, not-found and failed states in between. */
function StoredEditor({ kind, id, parent }: { kind: Kind; id: string; parent?: Parent }) {
  const query = useItem(kind, id, parent);
  if (query.data) return <Editor kind={kind} id={id} parent={parent} item={query.data} />;
  if (query.error?.status === 404) return <NotFoundState kind={kind} id={id} parent={parent} />;
  if (query.error) return <LoadErrorState kind={kind} id={id} error={query.error} retrying={query.isFetching} onRetry={() => void query.refetch()} />;
  return <EditorSkeleton kind={kind} />;
}
