// What links the two PEM boxes of a pair (Task 16 B23, pemBox.ts rule 10): a combined PEM given to
// either box offers one action that gives the certificates to the certificate box and the key to the
// key box, each through the box's own `set` (PemBoxes.tsx), as if the user had given it there.
import { useRef, type Ref } from 'react';
import type { SplitParts } from './pemBox';

/** A box's side the pair's split uses: text given to it as if the user had given it (its own `set`). */
export interface BoxHandle {
  take: (text: string) => void;
}

/** What links a pair's two boxes (usePairLink). */
export interface PairLink {
  certRef: Ref<BoxHandle>;
  keyRef: Ref<BoxHandle>;
  /** Gives the certificates to the certificate box and the key to the key box, each through its own `set`. */
  split: (parts: SplitParts) => void;
  /** The pair has a key already: the action says the key it gives replaces it. */
  keyEntered: boolean;
}

/**
 * Links the two boxes of a pair (rule 10). The caller passes `keyEntered` (its key's value is set)
 * and gives the link to both boxes; their onValue calls may come one after the other in the same
 * event, so a caller holding both values in one object builds the second from the first.
 */
export function usePairLink(keyEntered: boolean): PairLink {
  const certRef = useRef<BoxHandle>(null);
  const keyRef = useRef<BoxHandle>(null);
  return {
    certRef,
    keyRef,
    keyEntered,
    split: ({ certs, key }) => {
      certRef.current?.take(certs);
      keyRef.current?.take(key);
    },
  };
}
