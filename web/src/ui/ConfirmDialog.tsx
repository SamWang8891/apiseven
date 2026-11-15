import { AlertDialog } from 'radix-ui';
import { useRef, useState, type ReactNode } from 'react';
import { t } from '../i18n';
import { Button } from './Button';
import { ModalMark } from './Dialog';
import { PendingProvider, type PendingEntry } from './PendingContext';
import './overlay.css';

export interface ConfirmDialogProps {
  open: boolean;
  /** The question, naming the thing acted on: "Delete route game-api?" */
  title: string;
  body?: ReactNode;
  /** The action, as a verb: "Delete route". */
  confirmLabel: string;
  /** The other choice; default "Cancel". */
  cancelLabel?: string;
  danger?: boolean;
  /** Spinner on the confirm button; cancel and Escape are blocked meanwhile. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Asks before an action. Stays open until the caller closes it, so it can show `busy`. Focus starts
 * on Cancel. A field in the body that holds input it has not emitted (usePending) disables the action.
 * It has no trigger of its own: when it closes (Cancel, Escape, or the caller after the action), focus
 * goes back to what had it when it opened, or, when that is gone, to the page's `main`, never `body`.
 */
export function ConfirmDialog({ open, title, body, confirmLabel, cancelLabel, danger, busy, onConfirm, onCancel }: ConfirmDialogProps) {
  /** What had focus when the dialog opened (read as its focus moves in). */
  const returnTo = useRef<Element | null>(null);
  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => !next && !busy && onCancel()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="ui-overlay">
          <AlertDialog.Content
            className="ui-dialog ui-dialog--sm"
            {...(body === undefined ? { 'aria-describedby': undefined } : {})}
            onEscapeKeyDown={(e) => busy && e.preventDefault()}
            onOpenAutoFocus={() => {
              returnTo.current = document.activeElement;
            }}
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              const back = returnTo.current;
              returnTo.current = null;
              // Where the caller has already put focus (the field to fix, another dialog), it stays: the
              // dialog is gone by now, so focus on anything but body was put there on purpose.
              const now = document.activeElement;
              if (now instanceof HTMLElement && now !== document.body && now.isConnected) return;
              focusBack(back);
            }}
          >
            <header className="ui-dialog__header">
              <AlertDialog.Title className="ui-dialog__title">{title}</AlertDialog.Title>
            </header>
            <BodyAndActions {...{ body, confirmLabel, cancelLabel, danger, busy, onConfirm }} />
            <ModalMark />
          </AlertDialog.Content>
        </AlertDialog.Overlay>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

/**
 * Focus back on `back` (what had it when the dialog opened) when it is still there and usable, else on
 * the page's `main`. A tab that is not the selected one would be switched to by taking focus (Radix
 * tabs activate on focus), which is what the dialog may have just declined (Stay): its strip's
 * selected tab takes focus instead.
 */
function focusBack(back: Element | null) {
  const usable = back instanceof HTMLElement && back.isConnected && back !== document.body && !back.matches(':disabled');
  const tab = usable && back.getAttribute('role') === 'tab' && back.getAttribute('aria-selected') !== 'true';
  const target = tab ? back.closest('[role="tablist"]')?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') : usable ? back : undefined;
  (target ?? document.querySelector<HTMLElement>('main'))?.focus({ preventScroll: true });
}

/** The body, as a pending-input boundary, and the buttons; the action waits while the body holds input. Both go when the dialog closes. */
function BodyAndActions({ body, confirmLabel, cancelLabel, danger, busy, onConfirm }: Pick<ConfirmDialogProps, 'body' | 'confirmLabel' | 'cancelLabel' | 'danger' | 'busy' | 'onConfirm'>) {
  const [held, setHeld] = useState<PendingEntry[]>([]);
  return (
    <>
      {body !== undefined && (
        <AlertDialog.Description asChild>
          <div className="ui-dialog__body">
            <PendingProvider onChange={setHeld}>{body}</PendingProvider>
          </div>
        </AlertDialog.Description>
      )}
      <footer className="ui-dialog__footer">
        <AlertDialog.Cancel asChild>
          <Button variant="secondary" disabled={busy}>
            {cancelLabel ?? t('ui.cancel')}
          </Button>
        </AlertDialog.Cancel>
        <Button variant={danger ? 'danger' : 'primary'} loading={busy} disabled={held.length > 0} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </footer>
    </>
  );
}
