// The editor's overlays (moved out of Editor.tsx unchanged): leaving with unsaved work, a tab change
// that would drop held input, Discard, a save conflict, View JSON and Delete. Editor.tsx owns the
// state; these only show it and hand the choice back.
import type { Item, Kind, Parent, PluginInfo } from '../api/types';
import { t } from '../i18n';
import { DeleteResourceDialog, ViewJsonDialog } from '../pages/RowActions';
import { registry, type Ctx } from '../resources/registry';
import type { PendingEntry } from '../ui';
import { ConflictDialog } from './ConflictDialog';
import { DiscardDialog, PendingDialog } from './DiscardDialog';
import type { ActiveTab } from './useActiveTab';
import type { LeaveGuard } from './useLeaveGuard';

export interface EditorDialogsProps {
  kind: Kind;
  parent?: Parent;
  ctx: Ctx;
  /** The object's name as the header shows it. */
  name: string;
  /** The stored object (View JSON, Delete, and the conflict's "loaded" side); undefined while creating. */
  original?: Item;
  /** The kind's scope's plugin list, for masking secrets in the conflict diff. */
  plugins: Record<string, PluginInfo> | undefined;
  /** Leaving the page with unsaved work, or a tab change through the URL, held by the leave guard. */
  guard: LeaveGuard;
  /** A chosen tab change waiting while the tab holds input (`pending`). */
  tabState: Pick<ActiveTab, 'asking' | 'confirmSwitch' | 'cancelSwitch'>;
  pending: PendingEntry[];
  /** The ⋯ menu's and Discard's dialog, if one is open. */
  dialog?: 'json' | 'delete' | 'discard';
  closeDialog: () => void;
  /** Discard confirmed. */
  onDiscard: () => void;
  /** The server's item when a save found it changed; Overwrite, Reload or Cancel. */
  conflict?: Item;
  onOverwrite: () => void;
  onReload: (theirs: Item) => void;
  onCancelConflict: () => void;
  /** After a confirmed Delete. */
  onDeleted: () => void;
}

export function EditorDialogs(p: EditorDialogsProps) {
  const singular = registry[p.kind].singular;
  const { guard, tabState } = p;
  return (
    <>
      <DiscardDialog open={guard.blocked === 'leave'} name={p.name} onConfirm={guard.leave} onCancel={guard.stay} />
      <PendingDialog
        open={tabState.asking || guard.blocked === 'tab'}
        kind={singular}
        pending={p.pending}
        onConfirm={guard.blocked === 'tab' ? guard.leave : tabState.confirmSwitch}
        onCancel={guard.blocked === 'tab' ? guard.stay : tabState.cancelSwitch}
      />
      <DiscardDialog open={p.dialog === 'discard'} name={p.name} onConfirm={p.onDiscard} onCancel={p.closeDialog} />
      {p.conflict && p.original && (
        <ConflictDialog
          kind={singular}
          name={p.name}
          resource={p.kind}
          plugins={p.plugins}
          loaded={p.original.value}
          theirs={p.conflict.value}
          onOverwrite={p.onOverwrite}
          onReload={() => p.conflict && p.onReload(p.conflict)}
          onCancel={p.onCancelConflict}
        />
      )}
      {p.original && p.dialog === 'json' && (
        <ViewJsonDialog open onClose={p.closeDialog} title={t('json.title', { kind: singular, name: p.name })} kind={p.kind} value={p.original.value} />
      )}
      {p.original && p.dialog === 'delete' && (
        <DeleteResourceDialog open kind={p.kind} item={p.original} parent={p.parent} ctx={p.ctx} onClose={p.closeDialog} onDeleted={p.onDeleted} />
      )}
    </>
  );
}
