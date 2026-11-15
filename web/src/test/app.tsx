import { render } from '@testing-library/react';
import { vi } from 'vitest';
import type { Connection } from '../api/types';
import App from '../App';
import { resetReachability } from '../api/reachability';
import { STORAGE_KEYS } from '../connection/store';
import { fakeAdmin, type FakeAdminOptions } from './fakeAdmin';

/** A saved connection, as the Connect page would have stored it with "remember" ticked. */
export const DEV_CONN: Connection = { id: 'dev', name: 'dev', baseUrl: 'http://apisix.test:9180', key: 'admin-key' };

/** Writes saved connections the way the store does, and makes `activeId` the active one. */
export function saveConnections(list: (Connection & { sessionOnly?: boolean })[], activeId?: string): void {
  localStorage.setItem(STORAGE_KEYS.connections, JSON.stringify(list));
  if (activeId) localStorage.setItem(STORAGE_KEYS.active, activeId);
}

/** Renders the whole app at `hash`, with fetch answered by a fake Admin API. */
export function renderApp(opts: FakeAdminOptions & { hash?: string } = {}) {
  const admin = fakeAdmin(opts);
  vi.stubGlobal('fetch', admin.fetch);
  // replaceState, not location.hash: no hashchange/popstate event arrives after the router has started.
  window.history.replaceState(null, '', `/${opts.hash ?? ''}`);
  return { ...render(<App />), admin };
}

export function resetApp(): void {
  resetReachability();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
}
