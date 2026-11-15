import { DropdownMenu } from 'radix-ui';
import { useState, type ReactElement, type ReactNode } from 'react';
import { escapeFallback } from './escape';
import './overlay.css';

export type MenuItem =
  | { id: string; label: string; icon?: ReactNode; danger?: boolean; disabled?: boolean; onSelect: () => void }
  | { separator: true };

export interface MenuProps {
  /** A Button (or any element that forwards its ref and props) that opens the menu. */
  trigger: ReactElement;
  items: MenuItem[];
}

/** Dropdown of actions. Opens on click or Enter/Space/ArrowDown; arrows move, typing jumps. */
export function Menu({ trigger, items }: MenuProps) {
  const [open, setOpen] = useState(false);
  return (
    // Non-modal: a modal menu locks page scroll, and hiding the scrollbar shifts the layout under it.
    <DropdownMenu.Root modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="ui-popover ui-menu" align="end" sideOffset={4} collisionPadding={8} onKeyDown={escapeFallback(() => setOpen(false))}>
          {items.map((item, i) =>
            'separator' in item ? (
              <DropdownMenu.Separator key={`separator-${i}`} className="ui-menu__separator" />
            ) : (
              <DropdownMenu.Item
                key={item.id}
                className={item.danger ? 'ui-menu__item ui-menu__item--danger' : 'ui-menu__item'}
                disabled={item.disabled}
                onSelect={item.onSelect}
              >
                <span className="ui-menu__icon" aria-hidden="true">
                  {item.icon}
                </span>
                {item.label}
              </DropdownMenu.Item>
            ),
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
