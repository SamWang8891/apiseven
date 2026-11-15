import { useEffect, useSyncExternalStore } from 'react';

// How many modal dialogs (kit Dialog, ConfirmDialog) are open, so the toasts can keep clear of them.
let open = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Counts the calling component as an open modal while it is mounted (render it inside the dialog's content). */
export function useModalMark(): void {
  useEffect(() => {
    open++;
    emit();
    return () => {
      open--;
      emit();
    };
  }, []);
}

/** Whether any modal dialog is open. */
export function useModalOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => open > 0,
    () => false,
  );
}
