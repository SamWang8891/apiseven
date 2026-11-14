import { QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from './errors';

export interface QueryClientOptions {
  /**
   * A read failed with an auth error: the key is wrong or gone. Called with the connection id the
   * query belongs to (the first element of every key, see scopedKey). Mutation auth errors never
   * come here: a viewer key gets 401 on writes while its reads work.
   */
  onQueryAuthError: (error: ApiError, connId: string | undefined) => void;
}

export function createQueryClient({ onQueryAuthError }: QueryClientOptions): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (!(error instanceof ApiError) || error.kind !== 'auth') return;
        const connId = query.queryKey[0];
        onQueryAuthError(error, typeof connId === 'string' ? connId : undefined);
      },
    }),
    defaultOptions: {
      queries: {
        // Only a request that got no answer is worth repeating; an answer won't change by asking again.
        retry: (failures, error) => error instanceof ApiError && error.kind === 'network' && failures < 2,
        staleTime: 15_000,
      },
    },
  });
}
