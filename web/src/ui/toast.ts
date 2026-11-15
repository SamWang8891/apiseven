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
}

let items: ToastItem[] = [];
let lastId = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function push(tone: ToastTone, message: string, action?: ToastAction): void {
  items = [...items, { id: ++lastId, tone, message, ...(action ? { action } : {}) }];
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

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getToasts = (): ToastItem[] => items;
