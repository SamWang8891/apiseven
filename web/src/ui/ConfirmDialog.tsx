import { AlertDialog } from 'radix-ui';
import type { ReactNode } from 'react';
import { t } from '../i18n';
import { Button } from './Button';
import './overlay.css';

export interface ConfirmDialogProps {
  open: boolean;
  /** The question, naming the thing acted on: "Delete route game-api?" */
  title: string;
  body?: ReactNode;
  /** The action, as a verb: "Delete route". */
  confirmLabel: string;
  danger?: boolean;
  /** Spinner on the confirm button; cancel and Escape are blocked meanwhile. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Asks before an action. Stays open until the caller closes it, so it can show `busy`. Focus starts on Cancel. */
export function ConfirmDialog({ open, title, body, confirmLabel, danger, busy, onConfirm, onCancel }: ConfirmDialogProps) {
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
            {body !== undefined && (
              <AlertDialog.Description asChild>
                <div className="ui-dialog__body">{body}</div>
              </AlertDialog.Description>
            )}
            <footer className="ui-dialog__footer">
              <AlertDialog.Cancel asChild>
                <Button variant="secondary" disabled={busy}>
                  {t('ui.cancel')}
                </Button>
              </AlertDialog.Cancel>
              <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={onConfirm}>
                {confirmLabel}
              </Button>
            </footer>
          </AlertDialog.Content>
        </AlertDialog.Overlay>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
