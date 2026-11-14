// The page every resource is viewed and edited in: a stored object is loaded (with its loading,
// not-found and failed states), a new one starts from the kind's blank or a copy, and Editor.tsx
// does the rest. Tabs come from the registry, plus the frame's own JSON tab (id JSON_TAB in json.ts).
import type { FC } from 'react';
import { useItem } from '../api/hooks';
import { stripTimestamps } from '../api/sanitize';
import type { Item, Kind, Obj, Parent } from '../api/types';
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

/** A new object's baseline (what "unchanged" means) and its starting draft. */
function startOf(kind: Kind, duplicateFrom?: Item, initial?: Obj): { baseline: Obj; draft: Obj } {
  if (!duplicateFrom) {
    const blank = { ...registry[kind].blank(), ...initial };
    return { baseline: blank, draft: blank };
  }
  const source = stripTimestamps(duplicateFrom.value);
  const copy: Obj = { ...source };
  delete copy.id;
  if (kind === 'consumers') delete copy.username;
  if (typeof copy.name === 'string' && copy.name !== '') copy.name = t('editor.copyName', { name: copy.name });
  return { baseline: source, draft: copy };
}

export const EditorFrame: FC<EditorFrameProps> = ({ kind, id, parent, duplicateFrom, initial }) =>
  id === undefined ? (
    <Editor kind={kind} parent={parent} start={startOf(kind, duplicateFrom, initial)} copyOf={duplicateFrom} />
  ) : (
    <StoredEditor kind={kind} id={id} parent={parent} />
  );

/** Loads the object, then edits it; the loading, not-found and failed states in between. */
function StoredEditor({ kind, id, parent }: { kind: Kind; id: string; parent?: Parent }) {
  const query = useItem(kind, id, parent);
  if (query.data) return <Editor kind={kind} id={id} parent={parent} item={query.data} />;
  if (query.error?.status === 404) return <NotFoundState kind={kind} id={id} parent={parent} />;
  if (query.error) return <LoadErrorState kind={kind} id={id} error={query.error} retrying={query.isFetching} onRetry={() => void query.refetch()} />;
  return <EditorSkeleton kind={kind} />;
}
