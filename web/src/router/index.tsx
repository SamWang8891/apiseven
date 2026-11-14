import { lazy, Suspense } from 'react';
import { createHashRouter, Navigate, type RouteObject } from 'react-router';
import { ConnectPage } from '../connection/ConnectPage';
import { RouteErrorPage } from '../shell/ErrorPage';
import { Shell } from '../shell/Shell';
import { TooltipProvider } from '../ui';
import { pathFor } from './paths';
import { CredentialRoute, EditorRoute, ListRoute, NotFound } from './routeElements';

// The UI kit showcase, in development builds only (the import is dropped from production bundles).
const Gallery = import.meta.env.DEV ? lazy(() => import('../ui/Gallery')) : null;

const routes: RouteObject[] = [
  {
    path: '/',
    errorElement: <RouteErrorPage />,
    children: [
      { path: 'connect', element: <ConnectPage /> },
      ...(Gallery
        ? [
            {
              path: '__kit',
              element: (
                <TooltipProvider>
                  <Suspense fallback={null}>
                    <Gallery />
                  </Suspense>
                </TooltipProvider>
              ),
            },
          ]
        : []),
      {
        element: <Shell />,
        children: [
          {
            // Errors inside a page render in the shell's main area; the sidebar and header stay.
            errorElement: <RouteErrorPage />,
            children: [
              { index: true, element: <Navigate to={pathFor('routes')} replace /> },
              { path: ':kind', element: <ListRoute /> },
              { path: ':kind/new', element: <EditorRoute creating /> },
              { path: ':kind/:id', element: <EditorRoute /> },
              { path: 'consumers/:username/credentials/new', element: <CredentialRoute creating /> },
              { path: 'consumers/:username/credentials/:id', element: <CredentialRoute /> },
              { path: '*', element: <NotFound /> },
            ],
          },
        ],
      },
    ],
  },
];

/**
 * The app's hash router: #/connect, #/:kind (with ?q= and f.<filter>= for the list's search), #/:kind/new, #/:kind/:id,
 * #/consumers/:username/credentials/new|:id, and #/__kit in development.
 */
export function createAppRouter() {
  return createHashRouter(routes);
}
