import { useId } from 'react';
import type { FieldProps } from './Field';

/** Ids that tie a control to its Field label, help and error text. */
export interface FieldIds {
  id: string;
  /** For aria-describedby on the control: the error when there is one, else the help. */
  describedBy: string | undefined;
}

export const helpId = (id: string): string => `${id}-help`;
export const errorId = (id: string): string => `${id}-error`;

/** The control id (the caller's `id`, else a generated one) and what describes it. */
export function useFieldIds(id: string | undefined, field: Pick<FieldProps, 'help' | 'error'>): FieldIds {
  const generated = useId();
  const controlId = id ?? generated;
  const describedBy = field.error ? errorId(controlId) : field.help ? helpId(controlId) : undefined;
  return { id: controlId, describedBy };
}
