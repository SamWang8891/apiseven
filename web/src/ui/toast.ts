/** Transient notices. Call toast.success/error/info anywhere; mount <Toaster /> once to show them. */

export type ToastTone = 'success' | 'error' | 'info';

/** A link the toast offers (Radix Toast.Action): its text, and where it goes. */
export interface ToastAction {
  label: string;
  href: string;
}

export interface ToastOptions {
  action?: ToastAction;
  /**
   * About the page's own form (an editor's "Fix 2 problems before saving", a field that holds input):
   * it ends when the user leaves that page (setToastPage). Every other toast lives out its time.
   */
  pageBound?: boolean;
}

export interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
  action?: ToastAction;
  /** How many times this same notice was raised while it was there (shown as ×N from 2). */
  count: number;
  /** The page it was raised on (setToastPage), when it is page-bound. */
  page?: string;
}

/** How many toasts show at once; older ones wait, collapsed, behind a "+N more" row (Toaster). */
export const MAX_VISIBLE = 3;

let items: ToastItem[] = [];
let lastId = 0;
let page: string | undefined;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

const same = (a: ToastItem, tone: ToastTone, message: string, action?: ToastAction): boolean =>
  a.tone === tone && a.message === message && a.action?.label === action?.label && a.action?.href === action?.href;

function optionsOf(opts: ToastAction | ToastOptions | undefined): ToastOptions {
  if (!opts) return {};
  return 'href' in opts ? { action: opts } : opts;
}

/**
 * Adds a toast. One that says the same as a toast still there replaces it (a new id, so its time
 * starts again and it is announced again) and counts the repeat, so a refusal raised four times is
 * one toast, not four. None is ever dropped for being too many: the Toaster collapses older ones.
 */
function push(tone: ToastTone, message: string, opts?: ToastAction | ToastOptions): void {
  const { action, pageBound } = optionsOf(opts);
  const repeat = items.find((item) => same(item, tone, message, action));
  const rest = items.filter((item) => item !== repeat);
  const next: ToastItem = {
    id: ++lastId,
    tone,
    message,
    count: (repeat?.count ?? 0) + 1,
    ...(action ? { action } : {}),
    ...(pageBound && page !== undefined ? { page } : {}),
  };
  items = [...rest, next];
  emit();
}

export const toast = {
  success: (message: string, opts?: ToastAction | ToastOptions): void => push('success', message, opts),
  error: (message: string, opts?: ToastAction | ToastOptions): void => push('error', message, opts),
  info: (message: string, opts?: ToastAction | ToastOptions): void => push('info', message, opts),
};

export function dismissToast(id: number): void {
  items = items.filter((item) => item.id !== id);
  emit();
}

/**
 * The page the user is on (the router's pathname). A page-bound toast raised on another page goes:
 * a refusal about a form never lingers over the next page. Every other toast stays for its time,
 * so one the user is acting on ("can't delete: used by route X", then a click on X) is still there.
 */
export function setToastPage(next: string): void {
  if (next === page) return;
  page = next;
  const kept = items.filter((item) => item.page === undefined || item.page === next);
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
