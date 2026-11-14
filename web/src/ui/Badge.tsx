import type { ReactNode } from 'react';
import './badge.css';

export interface BadgeProps {
  tone: 'ok' | 'warn' | 'danger' | 'neutral' | 'accent';
  /** Always text: colour never carries the state alone. */
  children: ReactNode;
  icon?: ReactNode;
  /** Extra classes, e.g. a hook for tests or a page's own styles. */
  className?: string;
  title?: string;
}

export function Badge({ tone, children, icon, className, title }: BadgeProps) {
  return (
    <span className={className ? `ui-badge ui-badge--${tone} ${className}` : `ui-badge ui-badge--${tone}`} title={title}>
      {icon && (
        <span className="ui-badge__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      {children}
    </span>
  );
}
