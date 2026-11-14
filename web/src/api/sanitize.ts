import type { Obj } from './types';

/** True for a JSON object (not an array, not null). */
export function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withoutTimestamps(obj: Obj): Obj {
  const copy = { ...obj };
  delete copy.create_time;
  delete copy.update_time;
  return copy;
}

/**
 * Removes the server-set `create_time` / `update_time` that PUT and POST reject: at the top level,
 * inside `upstream`, and inside each `plugins.*`. Everything else is kept as is; the input is not modified.
 */
export function stripTimestamps(body: Obj): Obj {
  const out = withoutTimestamps(body);
  if (isObj(out.upstream)) out.upstream = withoutTimestamps(out.upstream);
  if (isObj(out.plugins)) {
    out.plugins = Object.fromEntries(
      Object.entries(out.plugins).map(([name, conf]) => [name, isObj(conf) ? withoutTimestamps(conf) : conf]),
    );
  }
  return out;
}
