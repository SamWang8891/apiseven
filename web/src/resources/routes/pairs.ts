// A route keeps three lists that APISIX also takes as one value: host/hosts, uri/uris and
// remote_addr/remote_addrs. The form edits each as one list; on write, one value goes in the
// single key and several in the plural one, and the other key of the pair is always removed
// (APISIX refuses both, "only one of host or hosts is allowed").
import type { Obj } from '../../api/types';

/** The list, from whichever key is set; the single key wins when (invalidly) both are. */
export function readPair(draft: Obj, single: string, plural: string): string[] {
  const one = draft[single];
  if (typeof one === 'string' && one !== '') return [one];
  const many = draft[plural];
  return Array.isArray(many) ? many.filter((v): v is string => typeof v === 'string') : [];
}

/** A copy of `draft` holding `values`: none → neither key; one → the single key; several → the plural key. */
export function writePair(draft: Obj, single: string, plural: string, values: string[]): Obj {
  const next: Obj = { ...draft };
  delete next[single];
  delete next[plural];
  if (values.length === 1) next[single] = values[0];
  else if (values.length > 1) next[plural] = [...values];
  return next;
}
