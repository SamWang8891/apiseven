// A draft as a schema form over the object's own settings sees it: without the frame's `id`, which a
// plugin metadata entry and a secret manager entry carry in their stored value (APISIX writes it,
// admin/resource.lua 110 and 321) but which is not one of their settings.
import { isObj } from '../api/sanitize';
import type { Obj } from '../api/types';

/** `draft` without `id`. */
export function withoutId(draft: Obj): Obj {
  const rest = { ...draft };
  delete rest.id;
  return rest;
}

/** The form's next value with the draft's `id` kept (first, as stored); the draft itself when the form gave no object. */
export const withId = (draft: Obj, next: unknown): Obj => (isObj(next) ? (draft.id !== undefined ? { id: draft.id, ...next } : next) : draft);
