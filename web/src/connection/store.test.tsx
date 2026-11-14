import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerConfig } from './bootstrap';
import { ConnectionsProvider, createConnectionStore, needsKey, STORAGE_KEYS, useConnections } from './store';

const KEY = 'sk-very-secret-admin-key';

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

function setup(server?: ServerConfig) {
  const store = createConnectionStore(server);
  const wrapper = ({ children }: { children: ReactNode }) => <ConnectionsProvider store={store}>{children}</ConnectionsProvider>;
  return renderHook(() => useConnections(), { wrapper });
}

const staging = { name: 'staging', baseUrl: 'http://10.0.0.5:9180', key: KEY };

/** Every name and value in localStorage, as one string. */
function everythingInLocalStorage(): string {
  let all = '';
  for (let i = 0; i < localStorage.length; i++) {
    const name = localStorage.key(i) ?? '';
    all += `${name}=${localStorage.getItem(name)}\n`;
  }
  return all;
}

describe('useConnections (static mode)', () => {
  it('starts empty, not server-managed', () => {
    const { result } = setup();
    expect(result.current.list).toEqual([]);
    expect(result.current.active).toBeUndefined();
    expect(result.current.serverManaged).toBe(false);
    expect(result.current.keyRequired).toBe(false);
  });

  it('add() mints a new id each time, makes the connection active and returns it', () => {
    const { result } = setup();
    let first!: ReturnType<typeof result.current.add>;
    let second!: ReturnType<typeof result.current.add>;
    act(() => {
      first = result.current.add(staging, true);
    });
    act(() => {
      second = result.current.add(staging, true);
    });
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.id).not.toBe(first.id);
    expect(first).toMatchObject(staging);
    expect(result.current.list.map((c) => c.id)).toEqual([first.id, second.id]);
    expect(result.current.active?.id).toBe(second.id);
    expect(localStorage.getItem(STORAGE_KEYS.active)).toBe(second.id);
  });

  it('add(..., true) keeps the key in localStorage, so a new tab still has it', () => {
    const { result } = setup();
    act(() => {
      result.current.add(staging, true);
    });
    expect(localStorage.getItem(STORAGE_KEYS.connections)).toContain(KEY);
    sessionStorage.clear();
    const reopened = setup();
    expect(reopened.result.current.active).toMatchObject(staging);
    expect(needsKey(reopened.result.current.active!)).toBe(false);
  });

  it('add(..., false) never writes the key to localStorage; it lives in sessionStorage', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { result } = setup();
    let added!: ReturnType<typeof result.current.add>;
    act(() => {
      added = result.current.add(staging, false);
    });
    // Every write to localStorage, not only the final state.
    const localWrites = setItem.mock.calls.filter((_, i) => setItem.mock.contexts[i] === localStorage);
    expect(localWrites.length).toBeGreaterThan(0);
    for (const [, value] of localWrites) expect(value).not.toContain(KEY);
    expect(everythingInLocalStorage()).not.toContain(KEY);
    expect(JSON.parse(sessionStorage.getItem(STORAGE_KEYS.sessionKeys)!)).toEqual({ [added.id]: KEY });
    expect(result.current.active?.key).toBe(KEY);

    // A reload in the same tab keeps the key...
    const reloaded = setup();
    expect(reloaded.result.current.active?.key).toBe(KEY);
    expect(needsKey(reloaded.result.current.active!)).toBe(false);
    // ...a new tab lists the connection but needs its key again.
    sessionStorage.clear();
    const newTab = setup();
    expect(newTab.result.current.list).toHaveLength(1);
    expect(newTab.result.current.active).toMatchObject({ name: 'staging', baseUrl: staging.baseUrl });
    expect(newTab.result.current.active?.key).toBeUndefined();
    expect(needsKey(newTab.result.current.active!)).toBe(true);
  });

  it('treats corrupt storage as empty, never crashing', () => {
    localStorage.setItem(STORAGE_KEYS.connections, '{not json');
    localStorage.setItem(STORAGE_KEYS.active, 'whatever');
    sessionStorage.setItem(STORAGE_KEYS.sessionKeys, '[1,');
    const { result } = setup();
    expect(result.current.list).toEqual([]);
    expect(result.current.active).toBeUndefined();
  });

  it('drops saved entries of the wrong shape and keeps the rest', () => {
    localStorage.setItem(
      STORAGE_KEYS.connections,
      JSON.stringify([{ id: 'ok', name: 'ok', baseUrl: 'http://a' }, { id: 1 }, null, 'x', { id: 'k', name: 'k', baseUrl: 'http://b', key: 7 }]),
    );
    sessionStorage.setItem(STORAGE_KEYS.sessionKeys, JSON.stringify(['not a map']));
    const { result } = setup();
    expect(result.current.list.map((c) => c.id)).toEqual(['ok']);
  });

  it('remove() of the active connection clears active, and forgets its session key', () => {
    const { result } = setup();
    let added!: ReturnType<typeof result.current.add>;
    act(() => {
      result.current.add({ name: 'one', baseUrl: 'http://one' }, true);
      added = result.current.add(staging, false);
    });
    act(() => result.current.remove(added.id));
    expect(result.current.active).toBeUndefined();
    expect(result.current.list.map((c) => c.name)).toEqual(['one']);
    expect(localStorage.getItem(STORAGE_KEYS.active)).toBeNull();
    expect(sessionStorage.getItem(STORAGE_KEYS.sessionKeys) ?? '').not.toContain(KEY);
  });

  it('setActive() switches and persists; disconnect() leaves the list as it is', () => {
    const { result } = setup();
    let one!: ReturnType<typeof result.current.add>;
    act(() => {
      one = result.current.add({ name: 'one', baseUrl: 'http://one' }, true);
      result.current.add({ name: 'two', baseUrl: 'http://two' }, true);
    });
    act(() => result.current.setActive(one.id));
    expect(result.current.active?.name).toBe('one');
    expect(localStorage.getItem(STORAGE_KEYS.active)).toBe(one.id);
    act(() => result.current.disconnect());
    expect(result.current.active).toBeUndefined();
    expect(result.current.list).toHaveLength(2);
  });
});

describe('useConnections (server-managed)', () => {
  it('without a key to ask for: one implicit connection to the page origin; saved connections are ignored', () => {
    localStorage.setItem(STORAGE_KEYS.connections, JSON.stringify([{ id: 'saved', name: 'saved', baseUrl: 'http://x' }]));
    localStorage.setItem(STORAGE_KEYS.active, 'saved');
    const { result } = setup({ adminBase: '/apisix/admin', keyRequired: false });
    expect(result.current.serverManaged).toBe(true);
    expect(result.current.keyRequired).toBe(false);
    expect(result.current.list).toEqual([{ id: 'server', name: location.host, baseUrl: location.origin }]);
    expect(result.current.active?.id).toBe('server');
  });

  it('with keyRequired: no connection until a key is added; the key follows the remember choice', () => {
    localStorage.setItem(STORAGE_KEYS.connections, JSON.stringify([{ id: 'saved', name: 'saved', baseUrl: 'http://x' }]));
    const server: ServerConfig = { adminBase: '/apisix/admin', keyRequired: true };
    const { result } = setup(server);
    expect(result.current.keyRequired).toBe(true);
    expect(result.current.list).toEqual([]);
    expect(result.current.active).toBeUndefined();

    act(() => {
      result.current.add({ name: location.host, baseUrl: location.origin, key: KEY }, false);
    });
    expect(result.current.active).toMatchObject({ baseUrl: location.origin, key: KEY });
    expect(everythingInLocalStorage()).not.toContain(KEY);
    // The saved static-mode connections were not touched.
    expect(localStorage.getItem(STORAGE_KEYS.connections)).toContain('saved');

    expect(setup(server).result.current.active?.key).toBe(KEY);
    sessionStorage.clear();
    expect(setup(server).result.current.active).toBeUndefined();
  });
});
