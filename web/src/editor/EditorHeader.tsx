// The editor's sticky header: what the object is, whether it is locked, and the actions.
import { ArrowLeft, Braces, Copy, Ellipsis, Lock, Pencil, Trash2 } from 'lucide-react';
import type { Ref } from 'react';
import { Link } from 'react-router';
import type { Item } from '../api/types';
import { t } from '../i18n';
import { IdCell } from '../resources/cells';
import { formatAbsolute, formatRelative } from '../table/format';
import { StatusIgnored } from '../table/StatusCell';
import { Badge, BusySwitch, Button, Menu, Tooltip } from '../ui';
import { clipTitle } from '../ui/clipTitle';

export interface EditorHeaderProps {
  title: string;
  /** The object's id; undefined while creating. */
  id?: string;
  back: { to: string; label: string };
  locked: boolean;
  isNew: boolean;
  dirty: boolean;
  /** The stored object, for the updated / created times. */
  original?: Item;
  /** For a copy: what it was copied from ("Copy of Route web"). */
  note?: string;
  /** The object this one belongs to (a credential's consumer), linked: "Consumer jo". */
  owner?: { kind: string; name: string; to: string };
  /**
   * Kinds with a status: whether the draft is enabled, and the switch's handler; `ignored` says why
   * the status does nothing for this object (ResourceDef.statusIgnored), which then has no switch.
   */
  status?: { enabled: boolean; ignored?: string; name: string; onChange: (enabled: boolean) => void };
  /** The key turned out read-only: Edit is unavailable, and while editing Save and Save anyway send nothing (api/write.ts), so they say so. */
  readOnly: boolean;
  saving: boolean;
  /** Save is impossible (the JSON tab holds text that doesn't parse). */
  saveBlocked: boolean;
  /** Save anyway, beside Save, while the frame offers it (SaveAnyway.tsx). */
  onSaveAnyway?: () => void;
  editRef: Ref<HTMLButtonElement>;
  onEdit: () => void;
  onSave: () => void;
  onDiscard: () => void;
  /** Undefined for a kind without Duplicate (ResourceDef.noDuplicate). */
  onDuplicate?: () => void;
  /** The ⋯ menu's Delete, named for what it does (Reset, for plugin metadata). */
  deleteLabel?: string;
  onViewJson: () => void;
  onDelete: () => void;
}

const epoch = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Updated 4m ago · Created 2026-11-14 09:30:05, from the stored object. */
function Times({ item }: { item: Item }) {
  const updated = epoch(item.value.update_time);
  const created = epoch(item.value.create_time);
  return (
    <>
      {updated !== undefined && (
        <time className="ed-meta__item" dateTime={new Date(updated * 1000).toISOString()} title={formatAbsolute(updated)}>
          {t('editor.updated', { time: formatRelative(updated) })}
        </time>
      )}
      {created !== undefined && (
        <time className="ed-meta__item ed-meta__item--shrink" dateTime={new Date(created * 1000).toISOString()} {...clipTitle(t('editor.createdAt', { time: formatAbsolute(created) }))}>
          {t('editor.createdAt', { time: formatAbsolute(created) })}
        </time>
      )}
    </>
  );
}

/**
 * Left: back to the list, the name, the id (copyable), Locked / Editing, and the status. Under them,
 * the times and "Unsaved changes". Right: Edit while locked; Discard and Save while editing (with
 * Save anyway between them while it is offered, so it stays in view however far down the refused
 * field is); the ⋯ menu for stored objects. Both states keep the same height, so unlocking moves nothing.
 */
export function EditorHeader({ editRef, ...p }: EditorHeaderProps) {
  const edit = (
    <Button
      ref={editRef}
      variant="primary"
      icon={<Pencil size={14} />}
      disabled={p.readOnly}
      aria-keyshortcuts="E"
      onClick={p.onEdit}
    >
      <>
        {t('editor.edit')}
        <kbd className="ed-kbd" aria-hidden="true">
          E
        </kbd>
      </>
    </Button>
  );

  return (
    <header className={p.locked ? 'ed-head' : 'ed-head ed-head--editing'}>
      <div className="ed-head__main">
        <div className="ed-head__line">
          <Link className="ed-back" to={p.back.to} aria-label={p.back.label} title={p.back.label}>
            <ArrowLeft size={16} aria-hidden="true" />
          </Link>
          <h1 className="ed-title" {...clipTitle(p.title)}>
            {p.title}
          </h1>
          {p.id !== undefined && (
            <span className="ed-id">
              <IdCell id={p.id} />
            </span>
          )}
          {p.locked ? (
            <Badge tone="neutral" icon={<Lock />} title={t('editor.lockedHint')}>
              {t('editor.locked')}
            </Badge>
          ) : (
            <Badge tone="accent" icon={<Pencil />}>
              {t('editor.editing')}
            </Badge>
          )}
          {p.status?.ignored !== undefined && <StatusIgnored why={p.status.ignored} />}
          {p.status && p.status.ignored === undefined && (
            <span className="ed-status">
              <Badge tone={p.status.enabled ? 'ok' : 'neutral'}>
                {p.status.enabled ? t('table.status.enabled') : t('table.status.disabled')}
              </Badge>
              {!p.locked && (
                // Busy, not disabled, while a save is out: it keeps focus (BusySwitch).
                <BusySwitch
                  checked={p.status.enabled}
                  busy={p.saving}
                  busyText={t('editor.status.saving')}
                  aria-label={t('table.status.toggle', { name: p.status.name })}
                  onCheckedChange={p.status.onChange}
                />
              )}
            </span>
          )}
        </div>
        <p className="ed-meta">
          {p.owner && (
            <span className="ed-meta__item ed-meta__item--shrink" {...clipTitle(`${p.owner.kind} ${p.owner.name}`)}>
              {p.owner.kind}{' '}
              <Link className="ed-owner mono" to={p.owner.to}>
                {p.owner.name}
              </Link>
            </span>
          )}
          {p.original && <Times item={p.original} />}
          {p.note !== undefined && (
            <span className="ed-meta__item ed-meta__item--shrink" {...clipTitle(p.note)}>
              {p.note}
            </span>
          )}
          {p.dirty && <span className="ed-meta__item ed-meta__dirty">{t('editor.unsaved')}</span>}
        </p>
      </div>

      <div className="ed-actions">
        {p.locked ? (
          p.readOnly ? (
            <Tooltip content={t('editor.readOnlyKey')}>
              {/* A disabled button gets no pointer or focus events; the wrapper carries the tooltip. */}
              <span className="ed-tipwrap" tabIndex={0}>
                {edit}
              </span>
            </Tooltip>
          ) : (
            edit
          )
        ) : (
          <>
            <Button disabled={p.saving} onClick={p.onDiscard}>
              {t('editor.discard')}
            </Button>
            {/*
              A key found read-only: nothing is sent (api/write.ts), so Save and Save anyway are
              unavailable where they are (aria-disabled keeps the focus of whoever just pressed one), with
              the reason; the draft stays to be copied out.
            */}
            {p.readOnly && (
              <span id="ed-readonly-why" hidden>
                {t('editor.readOnlySave')}
              </span>
            )}
            {p.onSaveAnyway && (
              <Button
                aria-disabled={p.saving || p.readOnly || undefined}
                onClick={p.onSaveAnyway}
                aria-describedby={p.readOnly ? 'ed-readonly-why' : 'ed-anyway-why'}
              >
                {t('editor.anyway.action')}
              </Button>
            )}
            <Button
              variant="primary"
              loading={p.saving}
              disabled={p.saveBlocked}
              aria-disabled={p.readOnly || undefined}
              aria-describedby={p.readOnly ? 'ed-readonly-why' : undefined}
              aria-keyshortcuts="Meta+S Control+S"
              onClick={p.onSave}
            >
              <>
                {p.isNew ? t('editor.create') : t('editor.save')}
                {p.dirty && <span className="ed-dot" aria-hidden="true" />}
              </>
            </Button>
          </>
        )}
        {!p.isNew && (
          <Menu
            trigger={<Button variant="ghost" icon={<Ellipsis size={16} />} aria-label={t('editor.more')} />}
            items={[
              ...(p.onDuplicate ? [{ id: 'duplicate', label: t('action.duplicate'), icon: <Copy size={14} />, onSelect: p.onDuplicate }] : []),
              { id: 'json', label: t('action.viewJson'), icon: <Braces size={14} />, onSelect: p.onViewJson },
              { separator: true },
              { id: 'delete', label: p.deleteLabel ?? t('action.delete'), icon: <Trash2 size={14} />, danger: true, disabled: p.readOnly || p.saving, onSelect: p.onDelete },
            ]}
          />
        )}
      </div>
    </header>
  );
}
