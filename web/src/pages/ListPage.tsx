import { Switch } from 'radix-ui';
import { useMemo, useState } from 'react';
import { useList } from '../api/hooks';
import type { Item, Kind, Parent } from '../api/types';
import { registry, useCtx, type Grouping } from '../resources/registry';
import { pageTitle, useDocumentTitle } from '../shell/documentTitle';
import { DataTable } from '../table/DataTable';
import { NewLink } from '../table/Toolbar';
import { tableStorageKey } from '../table/tableState';
import './list.css';
import { useResourceActions } from './useResourceActions';

const NONE: Item[] = [];
const NO_GROUPINGS: Grouping[] = [];

/** Where a list remembers its active grouping (the grouping id; absent when ungrouped). */
const groupStorageKey = (kind: Kind): string => `${tableStorageKey(kind)}.group`;

function storedGroup(kind: Kind): string | undefined {
  try {
    return localStorage.getItem(groupStorageKey(kind)) ?? undefined;
  } catch {
    return undefined;
  }
}

/** The active grouping (one at a time, remembered per kind) and a setter taking its id or undefined. */
function useGrouping(kind: Kind, groupings: Grouping[]): [Grouping | undefined, (id: string | undefined) => void] {
  const [id, setId] = useState(() => storedGroup(kind));
  const choose = (next: string | undefined) => {
    setId(next);
    try {
      if (next === undefined) localStorage.removeItem(groupStorageKey(kind));
      else localStorage.setItem(groupStorageKey(kind), next);
    } catch {
      // Storage refused (private mode, quota): the choice lasts until the page is left.
    }
  };
  return [groupings.find((g) => g.id === id), choose];
}

/** A grouping's on/off switch in the toolbar, labelled with its name ("Group by host"). */
function GroupToggle({ grouping, on, onChange }: { grouping: Grouping; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className={on ? 'list-toggle list-toggle--on' : 'list-toggle'}>
      <Switch.Root className="ui-switch" checked={on} onCheckedChange={onChange}>
        <Switch.Thumb className="ui-switch__thumb" />
      </Switch.Root>
      {grouping.label}
    </label>
  );
}

/** A kind's list page: title and count, then the table with the standard row and bulk actions. */
export function ListPage({ kind, parent }: { kind: Kind; parent?: Parent }) {
  const def = registry[kind];
  const list = useList(kind, parent);
  const ctx = useCtx();
  const actions = useResourceActions(kind, parent, ctx);
  const groupings = def.groupings ?? NO_GROUPINGS;
  const [grouping, setGrouping] = useGrouping(kind, groupings);
  useDocumentTitle(pageTitle(def.plural));
  // Stable while the grouping and the lists stay the same: the table regroups when these change.
  const groupBy = useMemo(() => grouping && ((item: Item) => grouping.groupBy(item, ctx)), [grouping, ctx]);
  const groupHeader = useMemo(
    () => (grouping?.header ? (group: string, items: Item[]) => grouping.header?.(group, items, ctx) : undefined),
    [grouping, ctx],
  );
  return (
    <div className="shell-page shell-page--fill">
      <div className="shell-page__head">
        <div className="list-title">
          <h1 tabIndex={-1}>{def.plural}</h1>
          {list.data && <span className="list-title__count">{list.data.length}</span>}
        </div>
        <NewLink kind={kind} parent={parent} />
      </div>
      <DataTable
        kind={kind}
        parent={parent}
        items={list.data ?? NONE}
        columns={def.columns}
        filters={def.filters}
        ctx={ctx}
        rowActions={actions.rowActions}
        bulkActions={actions.bulkActions}
        groupBy={groupBy}
        groupHeader={groupHeader}
        ungroupedLabel={grouping?.ungroupedLabel}
        toolbarExtra={
          groupings.length > 0 &&
          groupings.map((g) => (
            <GroupToggle key={g.id} grouping={g} on={g === grouping} onChange={(on) => setGrouping(on ? g.id : undefined)} />
          ))
        }
        noNewButton
        loading={list.isPending}
        // Data from before a failed refetch stays on screen; the error replaces the table only without it.
        error={list.data ? undefined : (list.error ?? undefined)}
        onRetry={() => void list.refetch()}
      />
      {actions.dialogs}
    </div>
  );
}
