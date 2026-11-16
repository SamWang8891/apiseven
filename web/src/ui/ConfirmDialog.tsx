import { AlertDialog } from 'radix-ui';
import { useId, useState, type ReactNode } from 'react';
import { t } from '../i18n';
import { Button } from './Button';
import { ModalMark } from './Dialog';
import { useReturnFocus } from './dialogFocus';
import { escapeFallback } from './escape';
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
  /**
   * Why the action can't be taken now (a key found read-only): the confirm button stays where it is,
   * focusable but unavailable (aria-disabled), with this said under the body and as its description.
   */
  unavailable?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Asks before an action. Stays open until the caller closes it, so it can show `busy`. Focus starts
 * on Cancel. A field in the body that holds input it has not emitted (usePending) disables the action.
 * It has no trigger of its own: when it closes (Cancel, Escape, or the caller after the action), focus
 * goes back where the user was (useReturnFocus, shared with Dialog), never to `body`.
 */
export function ConfirmDialog({ open, title, body, confirmLabel, cancelLabel, danger, busy, unavailable, onConfirm, onCancel }: ConfirmDialogProps) {
  /** Where the dialog was opened from (read as its focus moves in), and focus back there when it closes. */
  const returnFocus = useReturnFocus();
  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => !next && !busy && onCancel()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="ui-overlay">
          <AlertDialog.Content
            className="ui-dialog ui-dialog--sm"
            {...(body === undefined && unavailable === undefined ? { 'aria-describedby': undefined } : {})}
            onEscapeKeyDown={(e) => busy && e.preventDefault()}
            onKeyDown={escapeFallback(() => !busy && onCancel())}
            onOpenAutoFocus={returnFocus.onOpenAutoFocus}
            onCloseAutoFocus={returnFocus.onCloseAutoFocus}
          >
            <header className="ui-dialog__header">
              <AlertDialog.Title className="ui-dialog__title">{title}</AlertDialog.Title>
            </header>
            <BodyAndActions {...{ body, confirmLabel, cancelLabel, danger, busy, unavailable, onConfirm }} />
            <ModalMark />
          </AlertDialog.Content>
        </AlertDialog.Overlay>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

/** The body, as a pending-input boundary, and the buttons; the action waits while the body holds input. Both go when the dialog closes. */
function BodyAndActions({ body, confirmLabel, cancelLabel, danger, busy, unavailable, onConfirm }: Pick<ConfirmDialogProps, 'body' | 'confirmLabel' | 'cancelLabel' | 'danger' | 'busy' | 'unavailable' | 'onConfirm'>) {
  const [held, setHeld] = useState<PendingEntry[]>([]);
  const whyId = useId();
  return (
    <>
      {(body !== undefined || unavailable !== undefined) && (
        <AlertDialog.Description asChild>
          <div className="ui-dialog__body">
            <PendingProvider onChange={setHeld}>{body}</PendingProvider>
            {unavailable !== undefined && (
              <p id={whyId} className="ui-dialog__why">
                {unavailable}
              </p>
            )}
          </div>
        </AlertDialog.Description>
      )}
      <footer className="ui-dialog__footer">
        <AlertDialog.Cancel asChild>
          <Button variant="secondary" disabled={busy}>
            {cancelLabel ?? t('ui.cancel')}
          </Button>
        </AlertDialog.Cancel>
        <Button
          variant={danger ? 'danger' : 'primary'}
          loading={busy}
          disabled={held.length > 0}
          aria-disabled={unavailable !== undefined || undefined}
          aria-describedby={unavailable !== undefined ? whyId : undefined}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </footer>
    </>
  );
}
