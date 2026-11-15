/** Transient notices. Call toast.success/error/info anywhere; mount <Toaster /> once to show them. */

export type ToastTone = 'success' | 'error' | 'info';

/** A link the toast offers (Radix Toast.Action): its text, and where it goes. */
export interface ToastAction {
  label: string;
  href: string;
}

export interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
  action?: ToastAction;
  /** How many times this same notice was raised while it showed (shown as ×N from 2). */
  count: number;
  /** The page it was raised on (setToastPage), if the app says which. */
  page?: string;
}

/** At most this many toasts at once; a new one pushes the oldest out. */
export const MAX_TOASTS = 3;

let items: ToastItem[] = [];
let lastId = 0;
let page: string | undefined;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

const same = (a: ToastItem, tone: ToastTone, message: string, action?: ToastAction): boolean =>
  a.tone === tone && a.message === message && a.action?.label === action?.label && a.action?.href === action?.href;

/**
 * Adds a toast. One that says the same as a toast still showing replaces it (a new id, so its timer
 * starts again and it is announced again) and counts the repeat, so a refusal raised four times is one
 * toast, not four. Beyond MAX_TOASTS the oldest go.
 */
function push(tone: ToastTone, message: string, action?: ToastAction): void {
  const repeat = items.find((item) => same(item, tone, message, action));
  const rest = items.filter((item) => item !== repeat);
  const next: ToastItem = { id: ++lastId, tone, message, count: (repeat?.count ?? 0) + 1, ...(action ? { action } : {}), ...(page !== undefined ? { page } : {}) };
  items = [...rest, next].slice(-MAX_TOASTS);
  emit();
}

export const toast = {
  success: (message: string, action?: ToastAction): void => push('success', message, action),
  error: (message: string, action?: ToastAction): void => push('error', message, action),
  info: (message: string, action?: ToastAction): void => push('info', message, action),
};

export function dismissToast(id: number): void {
  items = items.filter((item) => item.id !== id);
  emit();
}

/**
 * The page the user is on (the router's pathname). Toasts raised from now on belong to it; error
 * toasts raised on another page go, so a refusal never lingers over the next page. Success and info
 * toasts stay: they often report what a navigation was for ("Deleted route web").
 */
export function setToastPage(next: string): void {
  if (next === page) return;
  page = next;
  const kept = items.filter((item) => item.tone !== 'error' || item.page === undefined || item.page === next);
  if (kept.length === items.length) return;
  items = kept;
  emit();
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getToasts = (): ToastItem[] => items;

/** How many toasts were raised so far, repeats included (ids count up from 1): for tests. */
export const toastsRaised = (): number => lastId;
