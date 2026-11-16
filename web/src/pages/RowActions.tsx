import { Copy, Eye, EyeOff, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useAllPlugins } from '../api/hooks';
import type { Item, Kind, Obj, Parent } from '../api/types';
import { useWrite, useWriteRefusal } from '../api/write';
import { t } from '../i18n';
import type { Ctx } from '../resources/ctx';
import { scopeOfKind, subsystemOf } from '../plugins/scope';
import { copiedWithout, redactObject } from '../plugins/secrets';
import { registry } from '../resources/registry';
import { listNames, protoUse } from '../resources/protos/columns';
import { referenceUse, type Reference } from '../resources/resolve';
import { pathFor } from '../router/paths';
import { Button, CodeEditor, ConfirmDialog, Dialog, toast, useReveal } from '../ui';
import './list.css';

/**
 * A stored object as pretty JSON, read-only, with a Copy button. Its secrets (an auth plugin's key:
 * redactObject) are masked until "Show secrets"; Copy copies what is shown.
 */
export function ViewJsonDialog({ open, onClose, title, kind, id, value }: { open: boolean; onClose: () => void; title: string; kind: Kind; id: string; value: Obj }) {
  const scope = scopeOfKind[kind];
  const plugins = useAllPlugins(scope && subsystemOf(scope)).data;
  const hidden = redactObject(value, kind, plugins, id);
  // Each opening starts masked (the dialog is mounted only while open), and a lock change hides them.
  const [revealed, setRevealed] = useReveal();
  const text = JSON.stringify(revealed ? hidden.revealed : hidden.value, null, 2);

  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(text);
      // The masked text says so: the clipboard has the mask characters, not the secrets.
      // The toast says what the clipboard lacks: secrets Show secrets would add, or a never-shown key.
      const without = copiedWithout(hidden, revealed);
      toast.success(without === 'masked' ? t('json.copiedMasked') : without === 'neverShown' ? t('json.copiedNoKey') : t('json.copied'));
    } catch (err) {
      toast.error(t('json.copyFailed', { error: err instanceof Error ? err.message : String(err) }));
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="lg"
      footer={
        <>
          {hidden.revealable && (
            <Button icon={revealed ? <EyeOff size={15} /> : <Eye size={15} />} aria-pressed={revealed} onClick={() => setRevealed((r) => !r)}>
              {revealed ? t('pl.card.secrets.hide') : t('pl.card.secrets.show')}
            </Button>
          )}
          <Button icon={<Copy size={15} />} onClick={() => void copy()}>
            {t('json.copy')}
          </Button>
          <Button variant="primary" onClick={onClose}>
            {t('ui.close')}
          </Button>
        </>
      }
    >
      <CodeEditor value={text} onChange={() => {}} language="json" readOnly minLines={6} maxLines={28} aria-label={title} />
    </Dialog>
  );
}

/** What uses an object, as links, under a warning line; `label` names the list for assistive tech. */
function RefList({ refs, warning, label }: { refs: Reference[]; warning: string; label?: string }) {
  return (
    <div className="list-refs">
      <p className="list-refs__warning">
        <TriangleAlert size={14} aria-hidden="true" />
        <span>{warning}</span>
      </p>
      <ul className="list-refs__list" aria-label={label}>
        {refs.map((ref) => (
          <li key={`${ref.kind}/${ref.id}`}>
            <Link to={pathFor(ref.kind, ref.id)}>
              <span className="list-refs__kind">{t(`kind.${ref.kind}.singular`)}</span> {ref.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The kinds APISIX's delete check of a proto looks at (admin/proto.lua 61–101); what else uses it only breaks. */
const PROTO_BLOCKERS = new Set<string>(['routes', 'services']);

/**
 * What uses the object, as the dialog lists it, once every list they come from has loaded ("checking…"
 * until then, and which list when one could not be read). A proto's users are split into those APISIX
 * refuses the delete over and those that just stop working.
 */
export function References({ kind, id, ctx }: { kind: Kind; id: string; ctx: Ctx }) {
  if (kind !== 'protos') {
    const use = referenceUse(kind, id, ctx);
    if ('failed' in use) {
      return (
        <p className="list-refs__warning">
          <TriangleAlert size={14} aria-hidden="true" />
          <span>{t('delete.unknown', { lists: listNames(use.failed) })}</span>
        </p>
      );
    }
    if ('loading' in use) return <p className="list-refs__warning">{t('delete.checking')}</p>;
    return use.refs.length > 0 ? <RefList refs={use.refs} warning={t('delete.inUse')} /> : null;
  }
  const use = protoUse(id, ctx);
  if ('failed' in use) {
    return (
      <p className="list-refs__warning">
        <TriangleAlert size={14} aria-hidden="true" />
        <span>{t('delete.uncheckable', { lists: listNames(use.failed) })}</span>
      </p>
    );
  }
  if ('loading' in use) return <p className="list-refs__warning">{t('delete.checking')}</p>;
  const { refs } = use;
  const refuses = refs.filter((ref) => PROTO_BLOCKERS.has(ref.kind));
  const breaks = refs.filter((ref) => !PROTO_BLOCKERS.has(ref.kind));
  return (
    <>
      {refuses.length > 0 && <RefList refs={refuses} warning={t('delete.refusedByWarning')} label={t('delete.refusedBy')} />}
      {breaks.length > 0 && <RefList refs={breaks} warning={t('delete.breaksWarning')} label={t('delete.breaks')} />}
    </>
  );
}

export interface DeleteResourceDialogProps {
  open: boolean;
  kind: Kind;
  item: Item;
  parent?: Parent;
  ctx: Ctx;
  onClose: () => void;
  onDeleted?: () => void;
}

/**
 * Asks before deleting, naming the object and listing what still uses it (from `referencesTo`).
 * When APISIX refuses (e.g. an upstream still in use), its message shows here and the dialog stays.
 */
export function DeleteResourceDialog({ open, kind, item, parent, ctx, onClose, onDeleted }: DeleteResourceDialogProps) {
  const write = useWrite();
  const refusal = useWriteRefusal();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const def = registry[kind];
  const name = def.nameOf(item);
  // A kind whose delete is a reset (plugin metadata) says so.
  const title = def.resets
    ? t('delete.reset.title', { kind: def.singular, name })
    : name === item.id
      ? t('delete.titleUnnamed', { kind: def.singular, id: item.id })
      : t('delete.title', { kind: def.singular, name, id: item.id });

  async function confirm() {
    setBusy(true);
    setError(undefined);
    const result = await write((client) => client.remove(kind, item.id, parent), {
      // A consumer's credentials go with it.
      invalidate: [{ kind, parent }, ...(kind === 'consumers' ? [{ kind: 'credentials' as const }] : [])],
      forget: [{ kind, id: item.id, parent }],
      success: t(def.resets ? 'delete.reset.done' : 'delete.done', { name }),
      silent: true,
    });
    setBusy(false);
    if (result.ok) {
      onDeleted?.();
      onClose();
    } else {
      setError(result.error.errorMsg ?? result.error.message);
    }
  }

  return (
    <ConfirmDialog
      open={open}
      danger
      busy={busy}
      unavailable={refusal}
      title={title}
      confirmLabel={def.resets ? t('action.reset') : t('delete.confirm', { kind: def.singular })}
      onConfirm={() => void confirm()}
      onCancel={() => {
        setError(undefined);
        onClose();
      }}
      body={
        <div className="list-delete">
          <p>{def.resets ? t('delete.reset.body', { name }) : t('delete.body')}</p>
          <References kind={kind} id={item.id} ctx={ctx} />
          {error && (
            <p className="list-error mono" role="alert">
              {error}
            </p>
          )}
        </div>
      }
    />
  );
}
