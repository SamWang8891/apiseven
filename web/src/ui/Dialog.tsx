import { X } from 'lucide-react';
import { Dialog as RadixDialog } from 'radix-ui';
import { useState, type ReactNode } from 'react';
import { t } from '../i18n';
import { Button } from './Button';
import { useReturnFocus } from './dialogFocus';
import { escapeFallback } from './escape';
import { useModalMark } from './modal';
import { PendingProvider, type PendingEntry } from './PendingContext';
import './overlay.css';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /**
   * Buttons, right-aligned on a bar below the body. As a function it gets what the body's fields hold
   * but have not emitted (usePending): disable the primary action while there is any.
   */
  footer?: ReactNode | ((held: PendingEntry[]) => ReactNode);
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Modal dialog: Escape, the close button and a click outside all call onClose. Its body is a
 * pending-input boundary: what its fields hold is the dialog's (see `footer`), never the page's. It has
 * no trigger of its own: when it closes, focus goes back where the user was, as from a ConfirmDialog
 * (useReturnFocus: the opener, a menu item's trigger), never to `body` (final wave O3).
 */
export function Dialog({ open, onClose, title, children, footer, size = 'md' }: DialogProps) {
  const returnFocus = useReturnFocus();
  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="ui-overlay">
          <RadixDialog.Content
            className={`ui-dialog ui-dialog--${size}`}
            aria-describedby={undefined}
            onKeyDown={escapeFallback(onClose)}
            onOpenAutoFocus={returnFocus.onOpenAutoFocus}
            onCloseAutoFocus={returnFocus.onCloseAutoFocus}
          >
            <header className="ui-dialog__header">
              <RadixDialog.Title className="ui-dialog__title">{title}</RadixDialog.Title>
              <RadixDialog.Close asChild>
                <Button variant="ghost" size="sm" icon={<X size={16} />} aria-label={t('ui.close')} />
              </RadixDialog.Close>
            </header>
            <BodyAndFooter footer={footer}>{children}</BodyAndFooter>
            <ModalMark />
          </RadixDialog.Content>
        </RadixDialog.Overlay>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/** The body, as a pending-input boundary, and the footer that hears what it holds; both go when the dialog closes. */
function BodyAndFooter({ footer, children }: { footer: DialogProps['footer']; children: ReactNode }) {
  const [held, setHeld] = useState<PendingEntry[]>([]);
  const bar = typeof footer === 'function' ? footer(held) : footer;
  return (
    <>
      <div className="ui-dialog__body">
        <PendingProvider onChange={setHeld}>{children}</PendingProvider>
      </div>
      {bar && <footer className="ui-dialog__footer">{bar}</footer>}
    </>
  );
}

/** Marks a modal as open while its content is mounted (the toasts keep clear of it: Toaster). */
export function ModalMark() {
  useModalMark();
  return null;
}
