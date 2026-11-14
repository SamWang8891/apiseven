import { createContext, createElement, useContext, useSyncExternalStore, type FC, type ReactNode } from 'react';
import { isObj } from '../api/sanitize';
import type { Connection } from '../api/types';
import { serverBaseUrl, type ServerConfig } from './bootstrap';

/** Where connections live in the browser. Corrupt JSON in any of them reads as empty. */
export const STORAGE_KEYS = {
  /** localStorage: JSON array of saved connections; a session-only one is stored without its key. */
  connections: 'apiseven.connections',
  /** localStorage: id of the active connection. */
  active: 'apiseven.activeConnection',
  /** sessionStorage: JSON map id → key, for connections added without "remember". */
  sessionKeys: 'apiseven.sessionKeys',
  /** localStorage, server-managed mode with keyRequired only: `{ id, key }` or `{ id, sessionOnly: true }`. */
  server: 'apiseven.serverConnection',
} as const;

/** A saved connection. `sessionOnly`: its key is kept for this tab only (sessionStorage), never in localStorage. */
export interface SavedConnection extends Connection {
  sessionOnly?: boolean;
}

/** True for a saved connection whose key stayed in another tab: it is listed, but needs its key again. */
export function needsKey(c: SavedConnection): boolean {
  return c.sessionOnly === true && c.key === undefined;
}

export interface Connections {
  list: SavedConnection[];
  active?: SavedConnection;
  /** Saves a connection under a new id and makes it active. `remember: false` keeps its key in this tab only. */
  add: (c: Omit<Connection, 'id'>, remember: boolean) => Connection;
  remove: (id: string) => void;
  setActive: (id: string) => void;
  /** Leaves the active connection; saved connections stay (server-managed: forgets the key). */
  disconnect: () => void;
  /** True when ./config.json was found (Docker mode). */
  serverManaged: boolean;
  /** Server-managed only: the user must still paste a key. */
  keyRequired: boolean;
  /** Server-managed only: the base URL of the server's Admin API proxy (what a key is checked against). */
  serverBaseUrl?: string;
}

export interface ConnectionStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => Connections;
}

interface State {
  list: SavedConnection[];
  activeId?: string;
}

/** The single connection of server-managed mode without a key to ask for. */
export const SERVER_CONNECTION_ID = 'server';

/**
 * Creates the connection store for one app. Static mode (no `server`): any number of saved
 * connections. Server-managed: saved connections are ignored; there is one connection to the
 * server's proxy, implicit when the server holds the key, otherwise made by entering a key.
 */
export function createConnectionStore(server?: ServerConfig): ConnectionStore {
  const listeners = new Set<() => void>();
  const mode = !server ? 'static' : server.keyRequired ? 'serverKey' : 'serverAuto';
  const serverBase = server ? serverBaseUrl(server) : '';

  const load = (): State => {
    if (mode === 'static') return loadStatic();
    if (mode === 'serverAuto') {
      return { list: [{ id: SERVER_CONNECTION_ID, name: location.host, baseUrl: serverBase }], activeId: SERVER_CONNECTION_ID };
    }
    const conn = loadServerKey(serverBase);
    return conn ? { list: [conn], activeId: conn.id } : { list: [] };
  };

  const save = (state: State) => {
    if (mode === 'static') saveStatic(state);
    else if (mode === 'serverKey') saveServerKey(state.list[0]);
  };

  const commit = (next: State) => {
    state = next;
    save(state);
    snapshot = build();
    for (const listener of listeners) listener();
  };

  const add: Connections['add'] = (c, remember) => {
    const conn: SavedConnection =
      mode === 'static' ? { id: newId(), name: c.name, baseUrl: c.baseUrl } : { id: newId(), name: location.host, baseUrl: serverBase };
    if (c.key !== undefined) {
      conn.key = c.key;
      if (!remember) conn.sessionOnly = true;
    }
    if (mode !== 'serverAuto') commit({ list: mode === 'static' ? [...state.list, conn] : [conn], activeId: conn.id });
    return { id: conn.id, name: conn.name, baseUrl: conn.baseUrl, ...(conn.key !== undefined && { key: conn.key }) };
  };

  const remove = (id: string) => {
    if (mode === 'serverAuto' || !state.list.some((c) => c.id === id)) return;
    const list = state.list.filter((c) => c.id !== id);
    commit({ list, activeId: state.activeId === id ? undefined : state.activeId });
  };

  const setActive = (id: string) => {
    if (mode === 'serverAuto' || !state.list.some((c) => c.id === id)) return;
    commit({ ...state, activeId: id });
  };

  const disconnect = () => {
    if (mode === 'static') commit({ ...state, activeId: undefined });
    else if (mode === 'serverKey') commit({ list: [] });
  };

  const build = (): Connections => ({
    list: state.list,
    active: state.list.find((c) => c.id === state.activeId),
    add,
    remove,
    setActive,
    disconnect,
    serverManaged: mode !== 'static',
    keyRequired: mode === 'serverKey',
    serverBaseUrl: server ? serverBase : undefined,
  });

  // Another tab saved or removed a connection: take its list, keeping this tab's active connection.
  const onStorage = (e: StorageEvent) => {
    if (mode !== 'static' || (e.key !== null && e.key !== STORAGE_KEYS.connections)) return;
    const { list } = loadStatic();
    state = { list, activeId: list.some((c) => c.id === state.activeId) ? state.activeId : undefined };
    snapshot = build();
    for (const listener of listeners) listener();
  };

  let state = load();
  let snapshot = build();

  return {
    subscribe: (listener) => {
      if (listeners.size === 0) window.addEventListener('storage', onStorage);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) window.removeEventListener('storage', onStorage);
      };
    },
    getSnapshot: () => snapshot,
  };
}

const StoreContext = createContext<ConnectionStore | null>(null);

export const ConnectionsProvider: FC<{ store: ConnectionStore; children: ReactNode }> = ({ store, children }) =>
  createElement(StoreContext, { value: store }, children);

function missingProvider(): never {
  throw new Error('useConnections() needs a <ConnectionsProvider> above it');
}

export function useConnections(): Connections {
  const store = useContext(StoreContext) ?? missingProvider();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

// --- storage --------------------------------------------------------------------------------

function storage(name: 'localStorage' | 'sessionStorage'): Storage | undefined {
  try {
    return window[name];
  } catch {
    return undefined; // Access denied (blocked site data): behave as if nothing is saved.
  }
}

function readJson(area: 'localStorage' | 'sessionStorage', key: string): unknown {
  try {
    const raw = storage(area)?.getItem(key);
    return raw === null || raw === undefined ? undefined : (JSON.parse(raw) as unknown);
  } catch {
    return undefined;
  }
}

function write(area: 'localStorage' | 'sessionStorage', key: string, value: string | undefined): void {
  try {
    if (value === undefined) storage(area)?.removeItem(key);
    else storage(area)?.setItem(key, value);
  } catch {
    // Full or blocked: the connection still works for this page's lifetime.
  }
}

function readSessionKeys(): Record<string, string> {
  const raw = readJson('sessionStorage', STORAGE_KEYS.sessionKeys);
  if (!isObj(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === 'string'));
}

function writeSessionKeys(keys: Record<string, string>): void {
  write('sessionStorage', STORAGE_KEYS.sessionKeys, Object.keys(keys).length > 0 ? JSON.stringify(keys) : undefined);
}

/** A stored connection, or undefined when its shape is wrong. The key is left out of session-only ones. */
function parseSaved(value: unknown): SavedConnection | undefined {
  if (!isObj(value) || typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.baseUrl !== 'string') {
    return undefined;
  }
  if (value.key !== undefined && typeof value.key !== 'string') return undefined;
  const conn: SavedConnection = { id: value.id, name: value.name, baseUrl: value.baseUrl };
  if (value.sessionOnly === true) conn.sessionOnly = true;
  else if (typeof value.key === 'string') conn.key = value.key;
  return conn;
}

/** What goes to localStorage: never the key of a session-only connection. */
function stored(c: SavedConnection): object {
  const base = { id: c.id, name: c.name, baseUrl: c.baseUrl };
  if (c.sessionOnly) return { ...base, sessionOnly: true };
  return c.key === undefined ? base : { ...base, key: c.key };
}

function loadStatic(): State {
  const raw = readJson('localStorage', STORAGE_KEYS.connections);
  const sessionKeys = readSessionKeys();
  const seen = new Set<string>();
  const list: SavedConnection[] = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    const conn = parseSaved(entry);
    if (!conn || seen.has(conn.id)) continue;
    seen.add(conn.id);
    const key = conn.sessionOnly ? sessionKeys[conn.id] : undefined;
    list.push(key === undefined ? conn : { ...conn, key });
  }
  let activeId: string | undefined;
  try {
    activeId = storage('localStorage')?.getItem(STORAGE_KEYS.active) ?? undefined;
  } catch {
    activeId = undefined;
  }
  return { list, activeId: list.some((c) => c.id === activeId) ? activeId : undefined };
}

function saveStatic(state: State): void {
  write('localStorage', STORAGE_KEYS.connections, JSON.stringify(state.list.map(stored)));
  write('localStorage', STORAGE_KEYS.active, state.activeId);
  const keys: Record<string, string> = {};
  for (const c of state.list) if (c.sessionOnly && c.key !== undefined) keys[c.id] = c.key;
  writeSessionKeys(keys);
}

function loadServerKey(baseUrl: string): SavedConnection | undefined {
  const raw = readJson('localStorage', STORAGE_KEYS.server);
  if (!isObj(raw) || typeof raw.id !== 'string') return undefined;
  const sessionOnly = raw.sessionOnly === true;
  const key = sessionOnly ? readSessionKeys()[raw.id] : typeof raw.key === 'string' ? raw.key : undefined;
  if (key === undefined) return undefined;
  return { id: raw.id, name: location.host, baseUrl, key, ...(sessionOnly && { sessionOnly }) };
}

function saveServerKey(conn: SavedConnection | undefined): void {
  write('localStorage', STORAGE_KEYS.server, conn ? JSON.stringify({ id: conn.id, ...(conn.sessionOnly ? { sessionOnly: true } : { key: conn.key }) }) : undefined);
  writeSessionKeys(conn?.sessionOnly && conn.key !== undefined ? { [conn.id]: conn.key } : {});
}

/** crypto.randomUUID needs a secure context; a plain-http LAN deployment only has getRandomValues. */
function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
