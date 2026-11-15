import { LoaderCircle } from 'lucide-react';
import { Switch as RadixSwitch } from 'radix-ui';
import { useId, type ComponentProps } from 'react';
import './toggle.css';

export type BusySwitchProps = Omit<ComponentProps<'button'>, 'onChange' | 'value' | 'children' | 'type' | 'disabled'> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Its write is out: the switch takes no change until it settles. */
  busy: boolean;
  /** What it says while busy ("Saving the new status…"). */
  busyText: string;
};

/**
 * A bare switch (no field around it: a table's status cell, the editor header) whose change is
 * written at once, so it can be busy. While busy it is `aria-disabled` and `aria-busy`, drops a
 * change, and says so: a spinner in its thumb, a tooltip, its description, and a polite live region
 * beside it; the colours of its state stay as they are (no fading).
 *
 * It is not `disabled` while busy: Chromium takes focus away from a focused control that becomes
 * disabled (focus fixup), so a keyboard user would lose their place and not hear that it is saving.
 * It keeps focus through the write and after it, a refused one too.
 */
export function BusySwitch({ checked, onCheckedChange, busy, busyText, className, ...native }: BusySwitchProps) {
  const sayId = useId();
  return (
    <>
      <RadixSwitch.Root
        {...native}
        className={['ui-switch', className].filter(Boolean).join(' ')}
        checked={checked}
        aria-disabled={busy || undefined}
        aria-busy={busy || undefined}
        aria-describedby={busy ? sayId : undefined}
        title={busy ? busyText : undefined}
        onCheckedChange={(next) => {
          if (!busy) onCheckedChange(next);
        }}
      >
        <RadixSwitch.Thumb className="ui-switch__thumb">{busy && <LoaderCircle className="ui-spin ui-switch__busy" size={10} aria-hidden="true" />}</RadixSwitch.Thumb>
      </RadixSwitch.Root>
      {/* Always there, so the text that appears in it is announced. */}
      <span className="ui-sr-only" id={sayId} aria-live="polite">
        {busy ? busyText : ''}
      </span>
    </>
  );
}
