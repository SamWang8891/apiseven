// Save anyway's state (Task 16 B18; the offer and the question are drawn by SaveAnyway.tsx): whether
// the offer stands is the frame's to say (Editor.tsx: Save was refused, and only the kind's own checks
// stand in the way); the confirmation, asked once per editing session, is kept here.
import { useState } from 'react';
import { t } from '../i18n';
import { tabOfIssue, type Issue, type TabFields } from './issues';
import { JSON_TAB } from './json';

/** A local problem as the question names it: the tab it is on, its path, what is wrong. */
export interface NamedIssue {
  tab: string;
  path: string;
  message: string;
}

export interface SaveAnyway {
  /** The offer shows: Save was refused, and only local checks stand in the way now. */
  offered: boolean;
  /** The question is open. */
  asking: boolean;
  /** The local problems, each with its tab's label. */
  issues: NamedIssue[];
  /** Save anyway pressed: asks first, unless already confirmed in this editing session. */
  press: () => void;
  confirm: () => void;
  cancel: () => void;
}

/**
 * The offer's state. `session` is the frame's editing session: a confirmation holds until it ends (a
 * save that APISIX accepts, Discard, reloading theirs), so a tab switch or a save APISIX refuses
 * does not ask again, and the next session does. `send` saves anyway through the frame.
 */
export function useSaveAnyway(a: {
  session: number;
  offered: boolean;
  checked: Issue[];
  /** The kind's tabs on show (their labels), and what each owns, in the same order; the JSON tab is added. */
  shown: { id: string; label: string }[];
  tabFields: TabFields[];
  send: () => void;
}): SaveAnyway {
  /** Frame editing state: the session in which the user confirmed; compared with the current one, so it ends with it. */
  const [confirmedIn, setConfirmedIn] = useState<number>();
  /** View state: the question is open (modal; only while the offer stands). */
  const [asking, setAsking] = useState(false);
  const label = (id: string) => a.shown.find((tab) => tab.id === id)?.label ?? t('editor.json.tab');
  const issues = a.checked.map((issue) => ({ tab: label(tabOfIssue(issue, a.tabFields, JSON_TAB)), path: issue.path, message: issue.message }));
  return {
    offered: a.offered,
    asking: asking && a.offered,
    issues,
    press: () => (confirmedIn === a.session ? a.send() : setAsking(true)),
    confirm: () => {
      setAsking(false);
      setConfirmedIn(a.session);
      a.send();
    },
    cancel: () => setAsking(false),
  };
}
