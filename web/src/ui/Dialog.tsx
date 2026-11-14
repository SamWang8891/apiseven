import { X } from 'lucide-react';
import { Dialog as RadixDialog } from 'radix-ui';
import type { ReactNode } from 'react';
import { t } from '../i18n';
import { Button } from './Button';
import './overlay.css';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** Buttons, right-aligned on a bar below the body. */
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

/** Modal dialog: Escape, the close button and a click outside all call onClose. */
export function Dialog({ open, onClose, title, children, footer, size = 'md' }: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="ui-overlay">
          <RadixDialog.Content className={`ui-dialog ui-dialog--${size}`} aria-describedby={undefined}>
            <header className="ui-dialog__header">
              <RadixDialog.Title className="ui-dialog__title">{title}</RadixDialog.Title>
              <RadixDialog.Close asChild>
                <Button variant="ghost" size="sm" icon={<X size={16} />} aria-label={t('ui.close')} />
              </RadixDialog.Close>
            </header>
            <div className="ui-dialog__body">{children}</div>
            {footer && <footer className="ui-dialog__footer">{footer}</footer>}
          </RadixDialog.Content>
        </RadixDialog.Overlay>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
