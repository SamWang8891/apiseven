import { useQueryClient, type Query } from '@tanstack/react-query';
import { CloudOff } from 'lucide-react';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { ApiError } from '../api/errors';
import { useClient } from '../api/hooks';
import { t } from '../i18n';
import { Button } from '../ui';

/**
 * The newest read of this connection that got no answer at all (kind `network`), unless a read has
 * succeeded since: then APISIX is reachable again. Undefined while all is well.
 */
function unreachableError(queries: Query[]): ApiError | undefined {
  let failedAt = 0;
  let failure: ApiError | undefined;
  let okAt = 0;
  for (const query of queries) {
    const { error, errorUpdatedAt, dataUpdatedAt, status } = query.state;
    if (status === 'error' && error instanceof ApiError && error.kind === 'network' && errorUpdatedAt > failedAt) {
      failedAt = errorUpdatedAt;
      failure = error;
    }
    okAt = Math.max(okAt, dataUpdatedAt);
  }
  return failedAt > okAt ? failure : undefined;
}

/**
 * Under the header on every page while the Admin API does not answer: which address, the error, and
 * Retry (which asks again for everything on screen). A page keeps showing what it loaded before, so
 * this says that it may be out of date; the banner goes by itself once a read succeeds.
 */
export function UnreachableBanner() {
  const client = useClient();
  const queryClient = useQueryClient();
  const connId = client.conn.id;
  const cache = queryClient.getQueryCache();
  const ofConn = useCallback((q: Query) => q.queryKey[0] === connId, [connId]);
  const error = useSyncExternalStore(
    useCallback((listener) => cache.subscribe(listener), [cache]),
    () => unreachableError(cache.findAll({ predicate: ofConn })),
  );
  const [retrying, setRetrying] = useState(false);
  if (!error) return null;
  const retry = () => {
    setRetrying(true);
    void queryClient.refetchQueries({ predicate: ofConn, type: 'active' }).finally(() => setRetrying(false));
  };
  return (
    <div className="shell-unreachable" role="alert">
      <CloudOff size={16} strokeWidth={2.25} aria-hidden="true" />
      <p className="shell-unreachable__text">
        <strong>{t('unreachable.title')}</strong> <span className="mono">{client.conn.baseUrl}</span>
        <span className="shell-unreachable__error">{t('unreachable.body', { error: error.message })}</span>
      </p>
      <Button size="sm" loading={retrying} onClick={retry}>
        {t('table.retry')}
      </Button>
    </div>
  );
}
