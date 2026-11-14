import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router';

/**
 * The active tab id as the `?tab=` search param says (null when absent). Choosing a tab takes
 * effect at once and is written to the URL (replacing the entry, so Back leaves the page rather than
 * stepping through tabs); a URL change made elsewhere (a link to `?tab=x`) is followed.
 */
export function useTabParam(): [string | null, (tab: string) => void] {
  const [params, setParams] = useSearchParams();
  const inUrl = params.get('tab');
  const [state, setState] = useState({ tab: inUrl, url: inUrl });

  let tab = state.tab;
  if (inUrl !== state.url) {
    // The URL moved: either our own write arriving (already shown) or a navigation to adopt.
    tab = inUrl;
    setState({ tab, url: inUrl });
  }

  const choose = useCallback(
    (next: string) => {
      setState((s) => ({ ...s, tab: next }));
      void setParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          params.set('tab', next);
          return params;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  return [tab, choose];
}
