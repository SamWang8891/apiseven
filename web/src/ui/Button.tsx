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
    /** Shows a spinner in place of the icon and blocks clicks, keeping the button's colours. */
    loading?: boolean;
  };

/**
 * A button. An icon-only one shows its label (`title`, else `aria-label`) as a tooltip on hover and
 * keyboard focus, wherever a TooltipProvider is above it; elsewhere as its native title.
 */
export function Button({ variant = 'secondary', size = 'md', icon, loading, children, className, type = 'button', disabled, title, ...native }: ButtonProps) {
  const tooltips = useTooltipsAvailable();
  const iconOnly = children === undefined || children === null;
  const classes = ['ui-btn', `ui-btn--${variant}`, `ui-btn--${size}`, iconOnly && 'ui-btn--icon-only', className].filter(Boolean).join(' ');
  const shownIcon = loading ? <LoaderCircle className="ui-spin" size={size === 'sm' ? 13 : 15} /> : icon;
  const label = native['aria-label'];
  const tip = iconOnly && tooltips ? (title ?? label) : undefined;
  const button = (
    <button {...native} title={tip === undefined ? (title ?? (iconOnly ? label : undefined)) : undefined} type={type} className={classes} disabled={disabled || loading} aria-busy={loading || undefined}>
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
