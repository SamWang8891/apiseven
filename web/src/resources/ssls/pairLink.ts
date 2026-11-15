// What links the two PEM boxes of a pair (Task 16 B23, pemBox.ts rule 10): a combined PEM given to
// either box offers one action that gives the certificates to the certificate box and the key to the
// key box, each through the box's own `set` (PemBoxes.tsx), as if the user had given it there.
import { useCallback, useState, useRef, type Ref } from 'react';
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
  /** The pair has a key already, or its key box holds text: the certificate box's action says it replaces it. */
  keyEntered: boolean;
  /** The pair has a certificate already, or its certificate box holds text: the key box's action says it replaces it. */
  certEntered: boolean;
  /** The certificate box says whether it holds text (it owns its text). */
  reportCertText: (holds: boolean) => void;
  /** The key box says whether it holds text (fix round 2, R8). */
  reportKeyText: (holds: boolean) => void;
  /** Either box offers the split now: a line beside the boxes that says to do by hand what the action does gives way (R11). */
  offered: boolean;
  /** A box says whether it offers the split. */
  reportOffer: (box: 'cert' | 'key', offers: boolean) => void;
}

/**
 * Links the two boxes of a pair (rule 10). The caller passes what its values are (`cert`, `key`: set
 * or not) and gives the link to both boxes; their onValue calls may come one after the other in the
 * same event, so a caller holding both values in one object builds the second from the first.
 */
export function usePairLink(values: { cert: boolean; key: boolean }): PairLink {
  const certRef = useRef<BoxHandle>(null);
  const keyRef = useRef<BoxHandle>(null);
  // View state, mirrors of each box's own state: whether it holds text (for the other box's label),
  // and whether it offers the split.
  const [certText, setCertText] = useState(false);
  const [keyText, setKeyText] = useState(false);
  const [offers, setOffers] = useState({ cert: false, key: false });
  const reportOffer = useCallback((box: 'cert' | 'key', on: boolean) => setOffers((now) => (now[box] === on ? now : { ...now, [box]: on })), []);
  return {
    certRef,
    keyRef,
    keyEntered: values.key || keyText,
    certEntered: values.cert || certText,
    reportCertText: setCertText,
    reportKeyText: setKeyText,
    offered: offers.cert || offers.key,
    reportOffer,
    split: ({ certs, key }) => {
      certRef.current?.take(certs);
      keyRef.current?.take(key);
    },
  };
}
