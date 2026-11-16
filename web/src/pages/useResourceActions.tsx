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
import { BulkReferences } from './BulkReferences';
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

  /**
   * One write per item, in order; then one reload and one toast with the outcome. A write refused for
   * the key (it is then read-only, api/write.ts) ends the run: the rest would be refused too.
   */
  async function each(label: string, items: Item[], op: (client: AdminClient, item: Item) => Promise<unknown>, progress?: (done: number, total: number) => void, deletes = false) {
    const failed: { item: Item; error: ApiError }[] = [];
    let stopped: { error: ApiError; done: number } | undefined;
    for (const [i, item] of items.entries()) {
      // A deleted object's cached item goes with it (WriteOptions.forget).
      const result = await write((client) => op(client, item), { silent: true, forget: deletes ? [{ kind, id: item.id, parent }] : [] });
      if (!result.ok) failed.push({ item, error: result.error });
      if (!result.ok && result.error.kind === 'auth') {
        stopped = { error: result.error, done: i + 1 - failed.length };
        break;
      }
      progress?.(i + 1, items.length);
    }
    await Promise.all([invalidate(kind, parent), ...(kind === 'consumers' ? [invalidate('credentials')] : [])]);
    if (stopped) {
      const { error, done } = stopped;
      // Items that failed for another reason before the key was refused are named, as bulk.someFailed names them.
      const earlier = failed.slice(0, -1);
      const firstEarlier = earlier[0];
      const why = error.errorMsg ?? error.message;
      toast.error(
        firstEarlier
          ? t('bulk.stoppedAfterFailures', {
              action: label,
              done,
              total: items.length,
              failed: earlier.length,
              names: earlier.map((f) => def.nameOf(f.item)).join(', '),
              reason: firstEarlier.error.errorMsg ?? firstEarlier.error.message,
              error: why,
            })
          : t('bulk.stopped', { action: label, done, total: items.length, error: why }),
      );
      return;
    }
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
      // An object whose status does nothing (ResourceDef.statusIgnored: a client SSL) is left alone,
      // and the toast names it with the reason; with nothing else selected, nothing is written.
      run: async (items, progress) => {
        const ignored = new Map<string, Item[]>();
        for (const item of items) {
          const reason = def.statusIgnored?.(item.value);
          if (reason !== undefined) ignored.set(reason, [...(ignored.get(reason) ?? []), item]);
        }
        const applies = items.filter((item) => def.statusIgnored?.(item.value) === undefined);
        if (applies.length > 0) await each(label, applies, (client, item) => client.patch(kind, item.id, { status: enable ? 1 : 0 }), progress);
        for (const [reason, left] of ignored) toast.info(t('bulk.statusIgnored', { action: label, names: left.map((item) => def.nameOf(item)).join(', '), reason }));
      },
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
          <BulkReferences kind={kind} items={items} ctx={ctx} />
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
