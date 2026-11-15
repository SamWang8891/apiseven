// What links the two PEM boxes of a pair (Task 16 B23, pemBox.ts rule 10): a combined PEM given to
// either box offers one action that gives the certificates to the certificate box and the key to the
// key box, each through the box's own `set` (PemBoxes.tsx), as if the user had given it there.
import { useState, useRef, type Ref } from 'react';
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
  /** The pair has a certificate already, or its certificate box holds text: the key box's action says it replaces it. */
  certEntered: boolean;
  /** The certificate box says whether it holds text (it owns its text). */
  reportCertText: (holds: boolean) => void;
}

/**
 * Links the two boxes of a pair (rule 10). The caller passes what its values are (`cert`, `key`: set
 * or not) and gives the link to both boxes; their onValue calls may come one after the other in the
 * same event, so a caller holding both values in one object builds the second from the first.
 */
export function usePairLink(values: { cert: boolean; key: boolean }): PairLink {
  const certRef = useRef<BoxHandle>(null);
  const keyRef = useRef<BoxHandle>(null);
  /** View state: the certificate box holds text (a mirror of its own state, for the key box's label). */
  const [certText, setCertText] = useState(false);
  return {
    certRef,
    keyRef,
    keyEntered: values.key,
    certEntered: values.cert || certText,
    reportCertText: setCertText,
    split: ({ certs, key }) => {
      certRef.current?.take(certs);
      keyRef.current?.take(key);
    },
  };
}
