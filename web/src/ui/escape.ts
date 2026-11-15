// Escape for the kit's overlays while a toast shows. Radix gives Escape to the highest layer only, and
// a toast raised after an overlay opened is higher; the toast leaves an Escape that is not about it
// unhandled (Toaster), and the overlay's content takes it as it bubbles out: one nothing inside
// handled first (a select inside a dialog, CodeMirror's completion). With no toast, Radix closes the
// overlay first and marks the key handled, so this does nothing.
import type { KeyboardEvent } from 'react';

/** An onKeyDown for an overlay's content: an Escape that reached it unhandled closes it. */
export const escapeFallback =
  (close: () => void) =>
  (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    close();
  };
