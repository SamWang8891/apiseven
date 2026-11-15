import { useSearchParams } from 'react-router';
import { useItem } from '../api/hooks';
import type { Kind, Obj, Parent } from '../api/types';
import { EditorFrame } from '../editor/EditorFrame';
import { EditorSkeleton, LoadErrorState, NotFoundState } from '../editor/states';
import { registry } from '../resources/registry';

/** The search params the kind lets a create page start with (ResourceDef.prefill), as fields of the new object. */
function prefillOf(kind: Kind, params: URLSearchParams): Obj | undefined {
  const entries = (registry[kind].prefill ?? []).flatMap((key) => {
    const value = params.get(key);
    return value === null || value === '' ? [] : [[key, value] as const];
  });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/**
 * The route element of #/<kind>/<id>, #/<kind>/new and the credential pages. `id` is decoded;
 * undefined on the create page, where `?from=<id>` starts from a copy of that object, and the
 * params the kind lists in `prefill` (`?service_id=s1`) are copied into the new object.
 */
export function EditorPage({ kind, id, parent }: { kind: Kind; id?: string; parent?: Parent }) {
  const [params] = useSearchParams();
  const from = id === undefined ? (params.get('from') ?? undefined) : undefined;
  if (from === undefined) return <EditorFrame kind={kind} id={id} parent={parent} initial={id === undefined ? prefillOf(kind, params) : undefined} />;
  return <DuplicateEditor key={from} kind={kind} from={from} parent={parent} />;
}

/** Loads the object to copy, then opens the create page from it. */
function DuplicateEditor({ kind, from, parent }: { kind: Kind; from: string; parent?: Parent }) {
  const source = useItem(kind, from, parent);
  if (source.data) return <EditorFrame kind={kind} parent={parent} duplicateFrom={source.data} />;
  if (source.error?.status === 404) return <NotFoundState kind={kind} id={from} parent={parent} copying />;
  if (source.error) return <LoadErrorState kind={kind} id={from} error={source.error} retrying={source.isFetching} onRetry={() => void source.refetch()} copying />;
  return <EditorSkeleton kind={kind} />;
}
