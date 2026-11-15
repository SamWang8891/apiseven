import { AlertDialog } from 'radix-ui';
import { useState, type ReactNode } from 'react';
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
 */
export function ConfirmDialog({ open, title, body, confirmLabel, cancelLabel, danger, busy, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => !next && !busy && onCancel()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="ui-overlay">
          <AlertDialog.Content
            className="ui-dialog ui-dialog--sm"
            {...(body === undefined ? { 'aria-describedby': undefined } : {})}
            onEscapeKeyDown={(e) => busy && e.preventDefault()}
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
