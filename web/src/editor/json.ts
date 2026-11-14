// The JSON tab's text handling, and how it reports text that doesn't parse to the frame.
import { createContext } from 'react';
import { isObj } from '../api/sanitize';
import type { Obj } from '../api/types';
import { t } from '../i18n';
import { deepEqual } from './draft';

/**
 * How the JSON tab tells the frame its text doesn't parse (undefined once it does), so Save is
 * blocked while it holds text the draft can't follow. Without a provider the tab still shows the error.
 */
export const JsonErrorContext = createContext<((error: string | undefined) => void) | null>(null);

export const pretty = (value: unknown): string => JSON.stringify(value, null, 2);

/**
 * The value with every object's keys in sorted order. APISIX hands keys back in an order that can
 * change between reads (Lua table order), so two versions are compared in this form.
 */
export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isObj(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  );
}

type Parsed = { ok: true; value: Obj } | { ok: false; error: string };

export function parse(text: string): Parsed {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: t('editor.json.invalid', { error: err instanceof Error ? err.message : String(err) }) };
  }
  return isObj(value) ? { ok: true, value } : { ok: false, error: t('editor.json.invalid', { error: t('editor.json.notObject') }) };
}

/** Whether `text` already says `draft` (so a draft change made from here doesn't reformat what was typed). */
export function represents(text: string, draft: Obj): boolean {
  const parsed = parse(text);
  return parsed.ok && deepEqual(parsed.value, draft);
}
