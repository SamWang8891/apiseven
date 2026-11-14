import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
// From 'react-router', not 'react-router/dom': the /dom entry only adds flushSync navigations (unused), and
// under Node (Vitest) it loads a second copy of the router whose context the routes can't see.
import { RouterProvider } from 'react-router';
import { createQueryClient } from './api/queryClient';
import { loadServerConfig, type ServerConfig } from './connection/bootstrap';
import type { ConnectState } from './connection/ConnectPage';
import { ConnectionsProvider, createConnectionStore } from './connection/store';
import { t } from './i18n';
import { createAppRouter } from './router';
import { AppErrorBoundary } from './shell/ErrorPage';
import { useTheme } from './shell/theme';

/** Shown while ./config.json decides between static and server-managed mode, so Connect never flashes. */
function Splash() {
  return (
    <div className="shell-splash" role="status" aria-label={t('app.loading')}>
      {t('app.name')}
    </div>
  );
}

/** The app once its mode is known: connections, the query cache and the router, created once. */
function Root({ server }: { server?: ServerConfig }) {
  const [app] = useState(() => {
    const store = createConnectionStore(server);
    const router = createAppRouter();
    const queryClient = createQueryClient({
      onQueryAuthError: (error, connId) => {
        // Only for the connection in use: a late answer for one just left is no reason to leave this one.
        if (connId === undefined || connId !== store.getSnapshot().active?.id) return;
        if (router.state.location.pathname === '/connect') return;
        const state: ConnectState = { reason: error.errorMsg ?? error.message, connId };
        void router.navigate('/connect', { state });
      },
    });
    return { store, router, queryClient };
  });

  return (
    <QueryClientProvider client={app.queryClient}>
      <ConnectionsProvider store={app.store}>
        <RouterProvider router={app.router} />
      </ConnectionsProvider>
    </QueryClientProvider>
  );
}

export default function App() {
  const [server, setServer] = useState<{ config?: ServerConfig }>();
  useTheme();

  useEffect(() => {
    let live = true;
    void loadServerConfig().then((config) => {
      if (live) setServer({ config });
    });
    return () => {
      live = false;
    };
  }, []);

  return <AppErrorBoundary>{server ? <Root server={server.config} /> : <Splash />}</AppErrorBoundary>;
}
