import { Tooltip as RadixTooltip } from 'radix-ui';
import { cloneElement, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { TooltipsProvided, useTooltipsAvailable } from './tooltipContext';
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
      <TooltipsProvided.Provider value>{children}</TooltipsProvided.Provider>
    </RadixTooltip.Provider>
  );
}

/**
 * The label of an icon-only control as its tooltip (same text as its aria-label), where a
 * TooltipProvider is above; elsewhere (the Connect page, a component on its own) its native title.
 */
export function LabelTip({ label, children }: { label: string; children: ReactElement<{ title?: string }> }) {
  return useTooltipsAvailable() ? <Tooltip content={label}>{children}</Tooltip> : cloneElement(children, { title: label });
}

/**
 * Whether the last thing the user did was a key press rather than a pointer press: focus that follows
 * a key (Tab, or Enter opening a dialog) is the keyboard's, as the browser's focus ring judges it.
 */
let keyboard = false;
let listening = false;
function listen(): void {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  document.addEventListener('keydown', () => (keyboard = true), true);
  document.addEventListener('pointerdown', () => (keyboard = false), true);
}

/**
 * A short hint on hover and keyboard focus. Not for anything the user must read to proceed. Focus
 * that follows a click (a dialog focusing its first button, a menu handing focus back to its
 * trigger) opens nothing.
 */
export function Tooltip({ content, children }: TooltipProps) {
  listen();
  const [open, setOpen] = useState(false);
  // Set by the trigger's focus, read by the open request Radix makes right after it.
  const byFocus = useRef<boolean | undefined>(undefined);
  return (
    <RadixTooltip.Root
      open={open}
      onOpenChange={(next) => {
        const quiet = next && byFocus.current === false;
        byFocus.current = undefined;
        if (!quiet) setOpen(next);
      }}
    >
      <RadixTooltip.Trigger
        asChild
        onFocus={() => {
          byFocus.current = keyboard;
          // Only for the request this focus makes (Radix asks at once, or not at all after a press).
          queueMicrotask(() => {
            byFocus.current = undefined;
          });
        }}
      >
        {children}
      </RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content className="ui-tooltip" sideOffset={6} collisionPadding={8}>
          {content}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
