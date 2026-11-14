import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router';
import { readSelection, writeSelection, type FilterSelection } from './filter';

/** What narrows a table down: the search text and each filter's selected values. */
export interface View {
  query: string;
  selection: FilterSelection;
}

const EMPTY: View = { query: '', selection: {} };

function fromParams(params: URLSearchParams): View {
  return { query: params.get('q') ?? '', selection: readSelection(params) };
}

function toParams(params: URLSearchParams, view: View): URLSearchParams {
  const next = writeSelection(params, view.selection);
  if (view.query) next.set('q', view.query);
  else next.delete('q');
  return next;
}

/** The view as it reads in the URL: q and f.* only, so other params don't count as a change. */
function keyOf(view: View): string {
  return toParams(new URLSearchParams(), view).toString();
}

/**
 * The search text and filter selections. `inUrl`: kept in the hash route's search params
 * (`q`, `f.<id>=a,b`), so a filtered view can be bookmarked and survives a reload; otherwise in
 * memory. The view itself updates at once; the URL follows (router updates are asynchronous), and
 * a URL change that did not come from here (Back, a link to the bare list) replaces the view.
 */
export function useView(inUrl: boolean): [View, (next: View) => void] {
  const [params, setParams] = useSearchParams();
  const urlKey = inUrl ? keyOf(fromParams(params)) : '';
  const [state, setState] = useState(() => ({
    view: inUrl ? fromParams(params) : EMPTY,
    /** The URL key last seen. */
    seen: urlKey,
    /** Keys written to the URL that it has not shown yet. */
    pending: [] as string[],
  }));

  let current = state;
  if (inUrl && urlKey !== state.seen) {
    const ours = state.pending.indexOf(urlKey);
    current =
      ours >= 0
        ? { view: state.view, seen: urlKey, pending: state.pending.slice(ours + 1) }
        : { view: fromParams(params), seen: urlKey, pending: [] };
    setState(current);
  }

  const update = useCallback(
    (next: View) => {
      setState((s) => {
        // A key equal to the URL's makes no URL change to wait for.
        const key = keyOf(next);
        return { ...s, view: next, pending: inUrl && key !== s.seen ? [...s.pending, key] : s.pending };
      });
      if (inUrl) setParams((prev) => toParams(prev, next), { replace: true });
    },
    [inUrl, setParams],
  );

  return [current.view, update];
}
