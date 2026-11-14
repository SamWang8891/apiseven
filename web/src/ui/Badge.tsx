import type { ReactNode } from 'react';
import './badge.css';

export interface BadgeProps {
  tone: 'ok' | 'warn' | 'danger' | 'neutral' | 'accent';
  /** Always text: colour never carries the state alone. */
  children: ReactNode;
  icon?: ReactNode;
}

export function Badge({ tone, children, icon }: BadgeProps) {
  return (
    <span className={`ui-badge ui-badge--${tone}`}>
      {icon && (
        <span className="ui-badge__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      {children}
    </span>
  );
}
