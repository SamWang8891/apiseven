import { useEffect, useSyncExternalStore } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'apiseven.theme';

const QUERY = '(prefers-color-scheme: dark)';
const listeners = new Set<() => void>();
/** The choice when storage can't be read (blocked site data). */
let fallback: ThemeChoice = 'system';

function isChoice(value: unknown): value is ThemeChoice {
  return value === 'light' || value === 'dark' || value === 'system';
}

/** localStorage is the source of truth, so every hook user (and every tab) sees one choice. */
function getChoice(): ThemeChoice {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === null) return fallback;
    return isChoice(saved) ? saved : 'system';
  } catch {
    return fallback;
  }
}

function setChoice(choice: ThemeChoice): void {
  fallback = choice;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Not saved; the choice holds for this page.
  }
  applyTheme(choice);
  for (const listener of listeners) listener();
}

function systemQuery(): MediaQueryList | undefined {
  return typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : undefined;
}

/** Sets data-theme on <html> (tokens.css switches on it). 'system' asks the OS. */
export function applyTheme(choice: ThemeChoice = getChoice()): void {
  const dark = choice === 'dark' || (choice === 'system' && systemQuery()?.matches === true);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

function subscribe(listener: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_STORAGE_KEY || e.key === null) listener();
  };
  listeners.add(listener);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/**
 * The theme choice and a setter. The choice is saved, applied to <html data-theme>, and while it is
 * 'system' the page follows the OS setting live.
 */
export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const choice = useSyncExternalStore(subscribe, getChoice);
  useEffect(() => {
    applyTheme(choice);
    if (choice !== 'system') return;
    const query = systemQuery();
    if (!query) return;
    const follow = () => applyTheme('system');
    query.addEventListener('change', follow);
    return () => query.removeEventListener('change', follow);
  }, [choice]);
  return [choice, setChoice];
}
