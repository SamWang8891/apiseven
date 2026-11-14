import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_STORAGE_KEY, useTheme } from './theme';

/** A controllable stand-in for matchMedia('(prefers-color-scheme: dark)'); jsdom has no matchMedia. */
function mockSystemTheme(initiallyDark: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const mql = {
    matches: initiallyDark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_: 'change', cb: (e: MediaQueryListEvent) => void) => listeners.add(cb),
    removeEventListener: (_: 'change', cb: (e: MediaQueryListEvent) => void) => listeners.delete(cb),
  };
  vi.stubGlobal('matchMedia', (query: string) => {
    expect(query).toBe('(prefers-color-scheme: dark)');
    return mql;
  });
  return {
    listeners,
    setDark(dark: boolean) {
      mql.matches = dark;
      for (const cb of [...listeners]) cb({ matches: dark } as MediaQueryListEvent);
    },
  };
}

beforeEach(() => {
  delete document.documentElement.dataset.theme;
});

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('useTheme', () => {
  it("defaults to 'system' and follows the OS", () => {
    mockSystemTheme(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current[0]).toBe('system');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('choosing dark sets data-theme="dark" on <html> and persists the choice', () => {
    mockSystemTheme(false);
    const { result } = renderHook(() => useTheme());
    expect(document.documentElement.dataset.theme).toBe('light');
    act(() => result.current[1]('dark'));
    expect(result.current[0]).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('restores a saved choice, and ignores a corrupt one', () => {
    mockSystemTheme(true);
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    const first = renderHook(() => useTheme());
    expect(first.result.current[0]).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    first.unmount();

    localStorage.setItem(THEME_STORAGE_KEY, 'purple');
    const second = renderHook(() => useTheme());
    act(() => second.result.current[1]('system'));
    expect(second.result.current[0]).toBe('system');
  });

  it("'system' reacts to the OS changing, and stops listening once another choice is made", () => {
    const os = mockSystemTheme(false);
    const { result } = renderHook(() => useTheme());
    act(() => result.current[1]('system'));
    expect(document.documentElement.dataset.theme).toBe('light');
    act(() => os.setDark(true));
    expect(document.documentElement.dataset.theme).toBe('dark');
    act(() => os.setDark(false));
    expect(document.documentElement.dataset.theme).toBe('light');

    act(() => result.current[1]('dark'));
    expect(os.listeners.size).toBe(0);
    act(() => os.setDark(false));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('every user of the hook sees the same choice', () => {
    mockSystemTheme(false);
    const a = renderHook(() => useTheme());
    const b = renderHook(() => useTheme());
    act(() => a.result.current[1]('dark'));
    expect(b.result.current[0]).toBe('dark');
  });
});
