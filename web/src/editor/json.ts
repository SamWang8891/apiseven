// The JSON tab's text handling.
import { isObj } from '../api/sanitize';
import type { Obj } from '../api/types';
import { t } from '../i18n';
import { deepEqual } from './draft';

/** The id of the frame's own JSON tab, after the kind's tabs. Registry tabs must not use it. */
export const JSON_TAB = 'json';

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

/** A failure says why (`error`, shown) and whether the text was JSON of another type than an object. */
type Parsed = { ok: true; value: Obj } | { ok: false; error: string; notObject?: boolean };

export function parse(text: string): Parsed {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: t('editor.json.invalid', { error: err instanceof Error ? err.message : String(err) }) };
  }
  return isObj(value) ? { ok: true, value } : { ok: false, error: t('editor.json.invalid', { error: t('editor.json.notObject') }), notObject: true };
}

/** Whether `text` already says `draft` (so a draft change made from here doesn't reformat what was typed). */
export function represents(text: string, draft: Obj): boolean {
  const parsed = parse(text);
  return parsed.ok && deepEqual(parsed.value, draft);
}
