// The page every resource is viewed and edited in: a stored object is loaded (with its loading,
// not-found and failed states), a new one starts from the kind's blank or a copy, and Editor.tsx
// does the rest. Tabs come from the registry, plus the frame's own JSON tab (id JSON_TAB in json.ts).
import { Info } from 'lucide-react';
import { useCallback, useState, type FC } from 'react';
import type { ApiError } from '../api/errors';
import { useAllPlugins, useItem } from '../api/hooks';
import type { Item, Kind, Obj, Parent } from '../api/types';
import { t } from '../i18n';
import { registry } from '../resources/registry';
import { Button } from '../ui';
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

/** APISIX said the object is not stored: its 404, never the client's refusal of an id no path can hold (also 404; Task 16b, item 142). */
const absent = (error: ApiError | null): boolean => error?.status === 404 && error.kind !== 'refused';

/**
 * Loads the object, then edits it; the loading, not-found and failed states in between. For a kind
 * whose pages exist whether or not anything is stored (ResourceDef.createWhenMissing), nothing stored
 * opens a new object under that id, and the page stays that create form whatever a later read says
 * (a refetch on window focus, a reconnect, an invalidation: one in flight even resets a query without
 * data to "pending"): only its own Create, or the user asking for what is stored, ends it. Nothing
 * the network does unmounts an editor that holds a draft: a stored object's query keeps its data
 * through a failed or 404 refetch, so its editor stays too. A refetch that finds the object deleted
 * (Task 16b, item 127) is told to the editor (`removed`): a draft being edited stays, with a notice;
 * a locked page (or one that locks later) gives way to Not found, or for a create-when-missing kind
 * to the create form.
 */
function StoredEditor({ kind, id, parent }: { kind: Kind; id: string; parent?: Parent }) {
  const query = useItem(kind, id, parent);
  const [creating, setCreating] = useState(false);
  // The locked editor gave way to what the page is now that the object is gone.
  const [left, setLeft] = useState(false);
  // The query keeps the deleted object's data; its 404 is newer (a success clears the error).
  const removed = query.data !== undefined && absent(query.error);
  const onRemoved = useCallback(() => {
    if (registry[kind].createWhenMissing) setCreating(true);
    else setLeft(true);
  }, [kind]);
  if (!creating && registry[kind].createWhenMissing && absent(query.error) && !query.data) setCreating(true);
  if (creating) return <MissingEditor kind={kind} id={id} parent={parent} found={removed ? undefined : query.data} onStored={() => setCreating(false)} />;
  if (query.data && !(left && removed)) {
    const notice = removed && <RemovedNotice kind={kind} name={registry[kind].nameOf(query.data)} />;
    return <Editor key="stored" kind={kind} id={id} parent={parent} item={query.data} notice={notice || undefined} removed={removed} onRemoved={onRemoved} />;
  }
  if (query.error?.status === 404) return <NotFoundState kind={kind} id={id} parent={parent} />;
  if (query.error) return <LoadErrorState kind={kind} id={id} error={query.error} retrying={query.isFetching} onRetry={() => void query.refetch()} />;
  return <EditorSkeleton kind={kind} id={id} />;
}

/** Above the tabs of a draft whose object was deleted elsewhere (item 127): the draft stays, Save can't store it there. */
function RemovedNotice({ kind, name }: { kind: Kind; name: string }) {
  return (
    <section className="ed-copynote" role="note" aria-label={t('editor.removed.title')}>
      <Info size={16} aria-hidden="true" />
      <div className="ed-copynote__text">
        <p className="ed-copynote__title">{t('editor.removed.title')}</p>
        <p>{t('editor.removed.body', { kind: registry[kind].singular, name })}</p>
      </div>
    </section>
  );
}

/**
 * A new object under the page's id, from the kind's blank; built once. When a read finds the object
 * stored meanwhile (`found`), the form stays and a note says so, with what is stored on request
 * (Create would be refused anyway: editor/save.ts never overwrites).
 */
function MissingEditor({ kind, id, parent, found, onStored }: { kind: Kind; id: string; parent?: Parent; found?: Item; onStored: () => void }) {
  const [start] = useState(() => startOf(kind, undefined, undefined, null));
  const notice = found && (
    <section className="ed-copynote" role="note" aria-label={t('editor.foundMeanwhile.title')}>
      <Info size={16} aria-hidden="true" />
      <div className="ed-copynote__text">
        <p className="ed-copynote__title">{t('editor.foundMeanwhile.title')}</p>
        <p>{t('editor.foundMeanwhile.body', { kind: registry[kind].singular, id })}</p>
        <p>
          <Button size="sm" onClick={onStored}>
            {t('editor.taken.show')}
          </Button>
        </p>
      </div>
    </section>
  );
  return <Editor key="missing" kind={kind} id={id} parent={parent} start={start} notice={notice || undefined} onStored={onStored} />;
}
