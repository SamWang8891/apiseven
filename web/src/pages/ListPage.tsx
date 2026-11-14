import { useList } from '../api/hooks';
import type { Item, Kind, Parent } from '../api/types';
import { registry, useCtx } from '../resources/registry';
import { DataTable } from '../table/DataTable';
import './list.css';
import { useResourceActions } from './useResourceActions';

const NONE: Item[] = [];

/** A kind's list page: title and count, then the table with the standard row and bulk actions. */
export function ListPage({ kind, parent }: { kind: Kind; parent?: Parent }) {
  const def = registry[kind];
  const list = useList(kind, parent);
  const ctx = useCtx();
  const actions = useResourceActions(kind, parent, ctx);
  return (
    <div className="shell-page shell-page--fill">
      <div className="shell-page__head">
        <div className="list-title">
          <h1>{def.plural}</h1>
          {list.data && <span className="list-title__count">{list.data.length}</span>}
        </div>
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
        loading={list.isPending}
        // Data from before a failed refetch stays on screen; the error replaces the table only without it.
        error={list.data ? undefined : (list.error ?? undefined)}
        onRetry={() => void list.refetch()}
      />
      {actions.dialogs}
    </div>
  );
}
