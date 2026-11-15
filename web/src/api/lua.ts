// JSON types as APISIX checks them. APISIX decodes JSON into Lua tables, and its schema validator
// takes an empty table for both an array and an object: `[]` passes `type: "object"` and `{}`
// passes `type: "array"` (verified on the dev APISIX 3.20: labels [], vars {}, methods {}, a
// protocol's conf [] and logger {} are all stored). A hand-written check that blocks Save must take
// them too (addendum rule 10); a non-empty value of the other type is still refused.
import { isObj } from './sanitize';

/** What the validator takes for `type: "object"`: an object, or an empty table (`[]`). */
export const isLuaObject = (v: unknown): boolean => isObj(v) || (Array.isArray(v) && v.length === 0);

/** What the validator takes for `type: "array"`: an array, or an empty table (`{}`). */
export const isLuaArray = (v: unknown): boolean => Array.isArray(v) || (isObj(v) && Object.keys(v).length === 0);
