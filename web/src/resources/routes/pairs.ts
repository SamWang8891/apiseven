// A route keeps three lists that APISIX also takes as one value: host/hosts, uri/uris and
// remote_addr/remote_addrs. The form edits each as one list; on write, one value goes in the
// single key and several in the plural one, and the other key of the pair is always removed
// (APISIX refuses both, "only one of host or hosts is allowed"). One value the single key's schema
// refuses stays in the plural key, where it is legal.
import type { Obj } from '../../api/types';

/**
 * Whether one value may stand in the single key, for the pairs whose single key is stricter than the
 * plural one's items: `uri` is a string of 1–4096 characters, `uris` items any string (APISIX 3.20
 * schema_def.lua 642–650). `host`/`hosts` (host_def, 58–61, 659–665), `remote_addr`/`remote_addrs`
 * (remote_addr_def, 91, 666–672) and `sni`/`snis` (host_def_pat, 922–932, 1100–1112) share one
 * definition, so a value one of them refuses the other refuses too.
 */
const FITS_SINGLE: Record<string, (value: string) => boolean> = {
  uri: (value) => value.length >= 1 && value.length <= 4096,
};

/** The list, from whichever key is set; the single key wins when (invalidly) both are. */
export function readPair(draft: Obj, single: string, plural: string): string[] {
  const one = draft[single];
  if (typeof one === 'string' && one !== '') return [one];
  const many = draft[plural];
  return Array.isArray(many) ? many.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * A copy of `draft` holding `values`: none → neither key; one → the single key, unless its schema
 * refuses the value (FITS_SINGLE), then the plural key; several → the plural key.
 */
export function writePair(draft: Obj, single: string, plural: string, values: string[]): Obj {
  const next: Obj = { ...draft };
  delete next[single];
  delete next[plural];
  const [only] = values;
  if (values.length === 1 && only !== undefined && (FITS_SINGLE[single]?.(only) ?? true)) next[single] = only;
  else if (values.length > 0) next[plural] = [...values];
  return next;
}
