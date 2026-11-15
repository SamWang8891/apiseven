import { Braces, Copy, Pencil, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import type { AdminClient } from '../api/client';
import type { ApiError } from '../api/errors';
import { useInvalidate } from '../api/hooks';
import type { Item, Kind, Parent } from '../api/types';
import { useReadOnlyKey, useWrite } from '../api/write';
import { t } from '../i18n';
import type { Ctx } from '../resources/ctx';
import { registry } from '../resources/registry';
import { newPathFor, pathFor } from '../router/paths';
import type { BulkAction, MenuItemFor } from '../table/DataTable';
import { toast } from '../ui';
import { DeleteResourceDialog, ViewJsonDialog } from './RowActions';

/** Names listed in the bulk delete confirmation before "and N more". */
const LISTED = 10;

export interface ResourceActions {
  /** Edit, Duplicate, View JSON, Delete. */
  rowActions: MenuItemFor;
  /** Enable and Disable for kinds with a status; Delete for all. */
  bulkActions: BulkAction[];
  /** The View JSON and Delete dialogs; render them next to the table. */
  dialogs: ReactNode;
}

/** The standard row and bulk actions of a kind's table (ListPage, and tables embedded in editors). */
export function useResourceActions(kind: Kind, parent: Parent | undefined, ctx: Ctx): ResourceActions {
  const navigate = useNavigate();
  const write = useWrite();
  const invalidate = useInvalidate();
  const readOnly = useReadOnlyKey();
  const [viewing, setViewing] = useState<Item>();
  const [deleting, setDeleting] = useState<Item>();
  const def = registry[kind];

  const rowActions: MenuItemFor = (item) => [
    { id: 'edit', label: t('action.edit'), icon: <Pencil size={14} />, onSelect: () => void navigate(pathFor(kind, item.id, parent)) },
    // Not with a key that turned out read-only: the copy could not be saved (as New, table/Toolbar NewLink).
    ...(def.noDuplicate || readOnly
      ? []
      : [
          {
            id: 'duplicate',
            label: t('action.duplicate'),
            icon: <Copy size={14} />,
            // The editor reads `from` and starts a new object from a copy of this one.
            onSelect: () => void navigate(`${newPathFor(kind, parent)}?from=${encodeURIComponent(item.id)}`),
          },
        ]),
    { id: 'json', label: t('action.viewJson'), icon: <Braces size={14} />, onSelect: () => setViewing(item) },
    { separator: true },
    { id: 'delete', label: def.resets ? t('action.reset') : t('action.delete'), icon: <Trash2 size={14} />, danger: true, disabled: readOnly, onSelect: () => setDeleting(item) },
  ];

  /** One write per item, in order; then one reload and one toast with the outcome. */
  async function each(label: string, items: Item[], op: (client: AdminClient, item: Item) => Promise<unknown>, progress?: (done: number, total: number) => void, deletes = false) {
    const failed: { item: Item; error: ApiError }[] = [];
    for (const [i, item] of items.entries()) {
      // A deleted object's cached item goes with it (WriteOptions.forget).
      const result = await write((client) => op(client, item), { silent: true, forget: deletes ? [{ kind, id: item.id, parent }] : [] });
      if (!result.ok) failed.push({ item, error: result.error });
      progress?.(i + 1, items.length);
    }
    await Promise.all([invalidate(kind, parent), ...(kind === 'consumers' ? [invalidate('credentials')] : [])]);
    const first = failed[0];
    if (!first) {
      toast.success(t('bulk.done', { action: label, done: items.length }));
      return;
    }
    toast.error(
      t('bulk.someFailed', {
        action: label,
        done: items.length - failed.length,
        failed: failed.length,
        names: failed.map((f) => def.nameOf(f.item)).join(', '),
        error: first.error.errorMsg ?? first.error.message,
      }),
    );
  }

  const status = (enable: boolean): BulkAction => {
    const label = t(enable ? 'action.enable' : 'action.disable');
    return {
      id: enable ? 'enable' : 'disable',
      label,
      disabled: readOnly,
      // An object whose status does nothing (ResourceDef.statusIgnored: a client SSL) is left alone.
      run: (items, progress) =>
        each(label, items.filter((item) => def.statusIgnored?.(item.value) === undefined), (client, item) => client.patch(kind, item.id, { status: enable ? 1 : 0 }), progress),
    };
  };

  const remove: BulkAction = {
    id: 'delete',
    label: t('action.delete'),
    danger: true,
    disabled: readOnly,
    confirm: (items) => ({
      title: t('bulk.delete.title', { count: items.length, plural: def.plural }),
      confirmLabel: t('bulk.delete.confirm', { count: items.length }),
      body: (
        <div className="list-delete">
          <p>{t('delete.body')}</p>
          <ul className="list-names">
            {items.slice(0, LISTED).map((item) => (
              <li key={item.id}>{def.nameOf(item)}</li>
            ))}
          </ul>
          {items.length > LISTED && <p>{t('bulk.delete.more', { count: items.length - LISTED })}</p>}
        </div>
      ),
    }),
    run: (items, progress) => each(t('action.delete'), items, (client, item) => client.remove(kind, item.id, parent), progress, true),
  };

  const dialogs = (
    <>
      {viewing && (
        <ViewJsonDialog
          open
          onClose={() => setViewing(undefined)}
          title={t('json.title', { kind: def.singular, name: def.nameOf(viewing) })}
          kind={kind}
          id={viewing.id}
          value={viewing.value}
        />
      )}
      {deleting && <DeleteResourceDialog open kind={kind} item={deleting} parent={parent} ctx={ctx} onClose={() => setDeleting(undefined)} />}
    </>
  );

  return { rowActions, bulkActions: def.hasStatus ? [status(true), status(false), remove] : [remove], dialogs };
}
