// Stable ids for rows that are rendered from a list in the value (the node table, CA certificates).
// A row's component, and what its fields hold, follows its id: keyed by position, a held "-" in a
// weight would land on the next node after a removal.
import { useState, type Dispatch, type SetStateAction } from 'react';

let lastId = 0;
export const freshIds = (n: number): number[] => Array.from({ length: Math.max(0, n) }, () => ++lastId);

/** `ids` without the one at `at`. */
export const withoutId = (ids: number[], at: number): number[] => ids.filter((_, i) => i !== at);

/** `ids` with `count` new ids inserted at `at` (rows inserted before the row now at `at`). */
export const withNewIds = (ids: number[], at: number, count: number): number[] => [...ids.slice(0, at), ...freshIds(count), ...ids.slice(at)];

/**
 * Ids for `count` rows. Each change the caller makes to the rows goes with the matching change here
 * (setIds with withoutId / withNewIds), in the same event; a change of length made elsewhere is met by
 * keeping the ids in front and making new ones at the end.
 */
export function useRowIds(count: number): [number[], Dispatch<SetStateAction<number[]>>] {
  const [ids, setIds] = useState(() => freshIds(count));
  if (ids.length !== count) {
    const fitted = ids.length > count ? ids.slice(0, count) : [...ids, ...freshIds(count - ids.length)];
    setIds(fitted);
    return [fitted, setIds];
  }
  return [ids, setIds];
}
