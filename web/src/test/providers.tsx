import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AdminClient } from '../api/client';
import { ClientProvider } from '../api/hooks';
import { Toaster, TooltipProvider } from '../ui';
import { DEV_CONN } from './app';
import { fakeAdmin, type FakeAdminOptions } from './fakeAdmin';

/**
 * Renders `ui` the way the Shell hosts a page, without the Shell: a memory router at `path`, the
 * query cache, an AdminClient on a fake Admin API, tooltips and toasts. `router.state.location`
 * shows where the page navigated; render again at that location to "reload".
 */
export function renderWithProviders(ui: ReactElement, opts: FakeAdminOptions & { path?: string } = {}) {
  const admin = fakeAdmin(opts);
  const client = new AdminClient(DEV_CONN, admin.fetch);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: '*', element: ui }], { initialEntries: [opts.path ?? '/'] });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <ClientProvider client={client}>
        <TooltipProvider>
          <RouterProvider router={router} />
          <Toaster />
        </TooltipProvider>
      </ClientProvider>
    </QueryClientProvider>,
  );
  return { ...result, admin, router, queryClient, client };
}

/** Where the memory router is now, as path + search (e.g. `/routes?q=foo`). */
export function locationOf(router: ReturnType<typeof createMemoryRouter>): string {
  const { pathname, search } = router.state.location;
  return pathname + search;
}
