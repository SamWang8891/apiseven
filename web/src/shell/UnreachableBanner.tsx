import { useQueryClient, type Query } from '@tanstack/react-query';
import { CloudOff } from 'lucide-react';
import { useState } from 'react';
import { useClient } from '../api/hooks';
import { usePageOwnsUnreachable, useUnreachable } from '../api/reachability';
import { t } from '../i18n';
import { Button } from '../ui';

/**
 * Under the header on every page while the Admin API does not answer (api/reachability.ts: a request
 * got no response, and none got one since): which address, the error, and Try again. A page keeps
 * showing what it loaded before, so this says that it may be out of date; the banner goes by itself
 * once any request is answered, an HTTP error included. On a page that shows its own load error with
 * its own retry (nothing loaded), the banner stands down: one message, one retry.
 *
 * Try again refetches the connection's queries that something on screen observes (lists, the object
 * an editor shows, counts). An editor never takes a refetched object over its draft while editing
 * (editor/Editor.tsx: a background refresh shows only on a locked, unchanged page), so nothing typed
 * is lost.
 */
export function UnreachableBanner() {
  const client = useClient();
  const queryClient = useQueryClient();
  const connId = client.conn.id;
  const error = useUnreachable(connId);
  const pageSaysSo = usePageOwnsUnreachable();
  const [retrying, setRetrying] = useState(false);
  if (!error || pageSaysSo) return null;
  const retry = () => {
    setRetrying(true);
    void queryClient.refetchQueries({ predicate: (q: Query) => q.queryKey[0] === connId, type: 'active' }).finally(() => setRetrying(false));
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
