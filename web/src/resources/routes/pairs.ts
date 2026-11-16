// A route keeps three lists that APISIX also takes as one value: host/hosts, uri/uris and
// remote_addr/remote_addrs. The form edits each as one list; on write, one value goes in the
// single key and several in the plural one, and the other key of the pair is always removed
// (APISIX refuses both, "only one of host or hosts is allowed"). One value the single key's schema
// refuses stays in the plural key, where it stays shown and flagged (a single key holding it may not
// be shown at all: readPair skips an empty one).
import type { Obj } from '../../api/types';
import { hostProblem, schemaAddress } from './validate';

/**
 * Whether one value may stand in the single key, by the single key's schema (APISIX 3.20
 * schema_def.lua): `uri` a string of 1–4096 characters (642; `uris` items any string, 643–650);
 * `host` host_def (58–61, 659) and `sni` the same pattern (922–925, 1100–1104); `remote_addr`
 * remote_addr_def (91–95, 666). A value it refuses is kept in the plural key.
 */
const FITS_SINGLE: Record<string, (value: string) => boolean> = {
  uri: (value) => value.length >= 1 && value.length <= 4096,
  host: (value) => hostProblem(value) === undefined,
  sni: (value) => hostProblem(value) === undefined,
  remote_addr: (value) => schemaAddress(value),
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
