import { AlertDialog } from 'radix-ui';
import { useId, useRef, useState, type ReactNode } from 'react';
import { t } from '../i18n';
import { Button } from './Button';
import { ModalMark } from './Dialog';
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
 * goes back where the user was (openedFrom, focusBack), never to `body`.
 */
export function ConfirmDialog({ open, title, body, confirmLabel, cancelLabel, danger, busy, unavailable, onConfirm, onCancel }: ConfirmDialogProps) {
  /** Where the dialog was opened from (read as its focus moves in). */
  const returnTo = useRef<Opener | null>(null);
  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => !next && !busy && onCancel()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="ui-overlay">
          <AlertDialog.Content
            className="ui-dialog ui-dialog--sm"
            {...(body === undefined && unavailable === undefined ? { 'aria-describedby': undefined } : {})}
            onEscapeKeyDown={(e) => busy && e.preventDefault()}
            onKeyDown={escapeFallback(() => !busy && onCancel())}
            onOpenAutoFocus={() => {
              returnTo.current = openedFrom(document.activeElement);
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
            <BodyAndActions {...{ body, confirmLabel, cancelLabel, danger, busy, unavailable, onConfirm }} />
            <ModalMark />
          </AlertDialog.Content>
        </AlertDialog.Overlay>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

/** Where a dialog was opened from: what had focus, the trigger of the menu it was in, the table around it. */
interface Opener {
  element: Element | null;
  /** When `element` was a menu item: its menu's trigger (a row's ⋯, the editor's ⋯), which outlives the menu. */
  trigger: HTMLElement | null;
  /** The table the opener sat in, for when its row has gone (deleted). */
  table: HTMLElement | null;
}

function openedFrom(element: Element | null): Opener {
  const menu = element?.closest('[role="menu"]');
  // Radix labels a menu by its trigger, and the trigger names the menu it controls while it is open.
  const labelledBy = menu?.getAttribute('aria-labelledby');
  const byLabel = labelledBy ? document.getElementById(labelledBy) : null;
  const byControls = menu?.id ? ([...document.querySelectorAll<HTMLElement>('[aria-controls]')].find((el) => el.getAttribute('aria-controls') === menu.id) ?? null) : null;
  const trigger = menu ? (byLabel ?? byControls) : null;
  const table = (trigger ?? element)?.closest<HTMLElement>('table') ?? null;
  return { element, trigger, table };
}

const usable = (el: Element | null | undefined): el is HTMLElement =>
  el instanceof HTMLElement && el.isConnected && el !== document.body && !el.matches(':disabled');

/**
 * Focus back where the user was: the menu's trigger when the dialog came from a menu item (the item
 * is gone), else what had focus. A tab that is not the selected one would be switched to by taking
 * focus (Radix tabs activate on focus), which is what the dialog may have just declined (Stay): its
 * strip's selected tab takes focus instead. When that is gone (its row was deleted), the table's
 * first row action; then the page's `main`; then its heading (the Connect page has no `main`).
 */
function focusBack(opener: Opener | null) {
  const back = opener?.trigger ?? opener?.element;
  const tab = usable(back) && back.getAttribute('role') === 'tab' && back.getAttribute('aria-selected') !== 'true';
  const candidates = [
    tab ? back.closest('[role="tablist"]')?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') : back,
    opener?.table?.isConnected ? opener.table.querySelector<HTMLElement>('.tbl-cell-actions button') : undefined,
    opener?.table ? document.querySelector<HTMLElement>('main h1[tabindex]') : undefined,
    document.querySelector<HTMLElement>('main'),
    document.querySelector<HTMLElement>('h1[tabindex]'),
  ];
  candidates.find(usable)?.focus({ preventScroll: true });
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
