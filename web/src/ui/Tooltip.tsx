import { Tooltip as RadixTooltip } from 'radix-ui';
import type { ReactElement, ReactNode } from 'react';
import './overlay.css';

export interface TooltipProps {
  content: ReactNode;
  /** The element described; it must forward its ref and props (a Button, a native element). */
  children: ReactElement;
}

/**
 * Shares the hover delay between tooltips: once one is open, moving to the next shows it at once.
 * Mount one near the root (the Shell does); every Tooltip needs one above it.
 */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={350} skipDelayDuration={200}>
      {children}
    </RadixTooltip.Provider>
  );
}

/** A short hint on hover and keyboard focus. Not for anything the user must read to proceed. */
export function Tooltip({ content, children }: TooltipProps) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content className="ui-tooltip" sideOffset={6} collisionPadding={8}>
          {content}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
