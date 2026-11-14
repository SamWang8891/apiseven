/** Transient notices. Call toast.success/error/info anywhere; mount <Toaster /> once to show them. */

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

let items: ToastItem[] = [];
let lastId = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function push(tone: ToastTone, message: string): void {
  items = [...items, { id: ++lastId, tone, message }];
  emit();
}

export const toast = {
  success: (message: string): void => push('success', message),
  error: (message: string): void => push('error', message),
  info: (message: string): void => push('info', message),
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
