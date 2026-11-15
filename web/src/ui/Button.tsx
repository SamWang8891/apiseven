import { LoaderCircle } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { Tooltip } from './Tooltip';
import { useTooltipsAvailable } from './tooltipContext';
import './button.css';

type Content =
  | { children: Exclude<ReactNode, null | undefined | boolean> }
  /** Icon-only: the label is required, since there is no visible text. */
  | { children?: null; 'aria-label': string };

export type ButtonProps = Omit<ComponentProps<'button'>, 'children'> &
  Content & {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    size?: 'sm' | 'md';
    icon?: ReactNode;
    /**
     * Shows a spinner in place of the icon and blocks clicks, keeping the button's colours. The button
     * stays focusable (aria-disabled, not disabled: Chromium moves focus off a disabled button to body).
     */
    loading?: boolean;
  };

/**
 * A button. An icon-only one shows its label (`title`, else `aria-label`) as a tooltip on hover and
 * keyboard focus, wherever a TooltipProvider is above it; elsewhere as its native title. Busy
 * (`loading`) or unavailable (`aria-disabled`), it does nothing when pressed (a form's submit
 * included) but keeps focus where a keyboard user is: give an unavailable one the reason
 * (aria-describedby). `disabled` is for a button the user is never on when it turns so.
 */
export function Button({ variant = 'secondary', size = 'md', icon, loading, children, className, type = 'button', disabled, title, onClick, ...native }: ButtonProps) {
  const tooltips = useTooltipsAvailable();
  const iconOnly = children === undefined || children === null;
  const classes = ['ui-btn', `ui-btn--${variant}`, `ui-btn--${size}`, iconOnly && 'ui-btn--icon-only', className].filter(Boolean).join(' ');
  const shownIcon = loading ? <LoaderCircle className="ui-spin" size={size === 'sm' ? 13 : 15} /> : icon;
  const label = native['aria-label'];
  const tip = iconOnly && tooltips ? (title ?? label) : undefined;
  const inert = loading === true || native['aria-disabled'] === true || native['aria-disabled'] === 'true';
  const button = (
    <button
      {...native}
      title={tip === undefined ? (title ?? (iconOnly ? label : undefined)) : undefined}
      type={type}
      className={classes}
      disabled={disabled}
      aria-disabled={inert || undefined}
      aria-busy={loading || undefined}
      // A press does nothing, a submit button submits nothing (implicit submission clicks it too), and
      // nothing around it hears the click, as with `disabled`.
      onClick={
        inert
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
            }
          : onClick
      }
    >
      {shownIcon && (
        <span className="ui-btn__icon" aria-hidden="true">
          {shownIcon}
        </span>
      )}
      {!iconOnly && <span className="ui-btn__label">{children}</span>}
    </button>
  );
  return tip === undefined ? button : <Tooltip content={tip}>{button}</Tooltip>;
}
