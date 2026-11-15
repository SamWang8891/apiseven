// The page every resource is viewed and edited in: a stored object is loaded (with its loading,
// not-found and failed states), a new one starts from the kind's blank or a copy, and Editor.tsx
// does the rest. Tabs come from the registry, plus the frame's own JSON tab (id JSON_TAB in json.ts).
import { useState, type FC } from 'react';
import { useAllPlugins, useItem } from '../api/hooks';
import type { Item, Kind, Obj, Parent } from '../api/types';
import { Editor } from './Editor';
import { startOf, type EditorStart } from './start';
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
  // Built once, and kept: the draft and the notes on what it left out belong together. A later
  // refetch of the source (on window focus) or of a failed list (pending again when the editor mounts
  // its own observer: following that would loop) changes neither.
  const [start, setStart] = useState<EditorStart>();
  if (!start && (!signIn || list.data !== undefined || list.isError)) setStart(startOf(kind, duplicateFrom, initial, list.data ?? null));
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
