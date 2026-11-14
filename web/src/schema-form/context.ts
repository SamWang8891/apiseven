// What every field of one form shares: its id prefix and where its errors landed (errors.ts).
import { createContext, use, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { t } from '../i18n';
import { fieldId } from './model';

export interface FormContextValue {
  prefix: string;
  /** What messages about the form's fields start with (a plugin's name); none by default. */
  name?: string;
  /** Dotted paths of secret values (the schema's encrypt_fields and the caller's), arrays transparent. */
  encrypt: string[];
  /** Messages by the dotted path of the rendered field that shows them ('' = the form as a whole). */
  errors: Map<string, string[]>;
}

export const FormContext = createContext<FormContextValue>({ prefix: 'sf', encrypt: [], errors: new Map() });

/** The secret paths of the form (see FormContextValue.encrypt). */
export function useEncryptPaths(): string[] {
  return use(FormContext).encrypt;
}

/** The DOM id of the field at `path`. */
export function useFieldId(path: string): string {
  return fieldId(use(FormContext).prefix, path);
}

/**
 * How a message about the field at `path` names it (usePending: a refused Save lists it): the dotted
 * path, after the form's name when it has one ("limit-count.count").
 */
export function useFieldName(path: string): string {
  const { name } = use(FormContext);
  return [name, path].filter((part) => part !== undefined && part !== '').join('.') || t('ui.pending.field');
}

/** The error to show on the field at `path` (several are joined), if any. */
export function useFieldError(path: string): string | undefined {
  const messages = use(FormContext).errors.get(path);
  return messages && messages.length > 0 ? messages.join('; ') : undefined;
}

/** Whether any error landed below `path` (a group holding one opens). */
export function useErrorBelow(path: string): boolean {
  const { errors } = use(FormContext);
  for (const at of errors.keys()) if (at !== path && (path === '' || at.startsWith(`${path}.`))) return true;
  return false;
}

/** A ref that always holds the latest `value`, for stable callbacks that need the current one. */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/** `value` while `key` stays the same, so a recomputed but equal value keeps its identity. */
export function useStableByKey<T>(value: T, key: string): T {
  const [held, setHeld] = useState({ key, value });
  if (held.key !== key) {
    setHeld({ key, value });
    return value;
  }
  return held.value;
}
