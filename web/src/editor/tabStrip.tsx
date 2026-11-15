// What the editor's tab strip shows (moved out of Editor.tsx unchanged): each tab's label, with a dot
// when a field it owns differs from the baseline (the JSON tab: anything does), its badge (its issues,
// APISIX's error when it is about a field there, and on the active tab the input its fields hold),
// and the active tab's content; the others have none, as only the active panel is mounted.
import type { ReactNode } from 'react';
import type { Obj } from '../api/types';
import { t } from '../i18n';
import type { PendingEntry, TabsProps } from '../ui';
import { deepEqual } from './draft';
import { ownedKeys, type Issue, type TabFields } from './issues';
import { JSON_TAB } from './json';

export function tabStrip(a: {
  /** The kind's tabs on show, and what each owns (in the same order). */
  shown: { id: string; label: string }[];
  tabFields: TabFields[];
  draft: Obj;
  baseline: Obj;
  dirty: boolean;
  active: string;
  /** The active tab's content. */
  content: ReactNode;
  byTab: Map<string, Issue[]>;
  /** The tab APISIX's refusal is about, if any. */
  failureTab: string | undefined;
  pending: PendingEntry[];
}): TabsProps['tabs'] {
  const changedHere = (tab: TabFields) => ownedKeys(tab, a.tabFields, a.draft, a.baseline).some((field) => !deepEqual(a.draft[field], a.baseline[field]));
  const label = (text: string, changed: boolean) => (
    <>
      {text}
      {changed && <span className="ed-dot" aria-hidden="true" />}
    </>
  );
  const badge = (tab: string) => (a.byTab.get(tab)?.length ?? 0) + (a.failureTab === tab ? 1 : 0) + (tab === a.active ? a.pending.length : 0);
  return [
    ...a.shown.map((tab, i) => ({ id: tab.id, label: label(tab.label, changedHere(a.tabFields[i] ?? { id: tab.id, fields: [] })), badge: badge(tab.id), content: tab.id === a.active ? a.content : null })),
    { id: JSON_TAB, label: label(t('editor.json.tab'), a.dirty), badge: badge(JSON_TAB), content: a.active === JSON_TAB ? a.content : null },
  ];
}
