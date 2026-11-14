import type { CSSProperties, ReactNode } from 'react';
import { t } from '../i18n';

/** Shown in place of an input while locked: the value as full-contrast text, `—` when empty. */
export function ReadOnlyValue({
  children,
  mono,
  className,
  tabIndex,
  style,
}: {
  children: ReactNode;
  mono?: boolean;
  className?: string;
  /** 0 for a value long enough to scroll, so keyboard users can scroll it. */
  tabIndex?: number;
  style?: CSSProperties;
}) {
  const empty = children === undefined || children === null || children === '';
  const classes = ['ro-value', mono && !empty && 'mono', empty && 'ro-value--empty', className].filter(Boolean).join(' ');
  return (
    <span className={classes} tabIndex={empty ? undefined : tabIndex} style={style}>
      {empty ? t('ui.empty') : children}
    </span>
  );
}
