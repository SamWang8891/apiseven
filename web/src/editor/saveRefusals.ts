// The editor's refused Saves, for parts of a tab that react to one without the tab passing it down
// (resources/Section opens on one while it holds a problem): the editing session and the refused
// Saves in it (TabProps.saveAttempts, which starts over with each session).
import { createContext } from 'react';

export interface SaveRefusals {
  session: number;
  attempts: number;
}

export const SaveRefusalsContext = createContext<SaveRefusals>({ session: 0, attempts: 0 });

/** Whether a Save was refused after `since` (a moment as this context told it). */
export const refusedSince = (now: SaveRefusals, since: SaveRefusals): boolean =>
  now.session === since.session ? now.attempts > since.attempts : now.attempts > 0;
