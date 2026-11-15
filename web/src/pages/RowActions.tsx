import { Copy, Eye, EyeOff, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useAllPlugins } from '../api/hooks';
import type { Item, Kind, Obj, Parent } from '../api/types';
import { useWrite } from '../api/write';
import { t } from '../i18n';
import type { Ctx } from '../resources/ctx';
import { scopeOfKind, subsystemOf } from '../plugins/scope';
import { redactObject } from '../plugins/secrets';
import { registry } from '../resources/registry';
import { referencesTo } from '../resources/resolve';
import { pathFor } from '../router/paths';
import { Button, CodeEditor, ConfirmDialog, Dialog, toast, useReveal } from '../ui';
import './list.css';

/**
 * A stored object as pretty JSON, read-only, with a Copy button. Its secrets (an auth plugin's key:
 * redactObject) are masked until "Show secrets"; Copy copies what is shown.
 */
export function ViewJsonDialog({ open, onClose, title, kind, value }: { open: boolean; onClose: () => void; title: string; kind: Kind; value: Obj }) {
  const scope = scopeOfKind[kind];
  const plugins = useAllPlugins(scope && subsystemOf(scope)).data;
  const hidden = redactObject(value, kind, plugins);
  // Each opening starts masked (the dialog is mounted only while open), and a lock change hides them.
  const [revealed, setRevealed] = useReveal();
  const text = JSON.stringify(hidden.redacted && !revealed ? hidden.value : value, null, 2);

  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(text);
      toast.success(t('json.copied'));
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
          {hidden.redacted && (
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const def = registry[kind];
  const name = def.nameOf(item);
  const refs = referencesTo(kind, item.id, ctx);
  const title =
    name === item.id ? t('delete.titleUnnamed', { kind: def.singular, id: item.id }) : t('delete.title', { kind: def.singular, name, id: item.id });

  async function confirm() {
    setBusy(true);
    setError(undefined);
    const result = await write((client) => client.remove(kind, item.id, parent), {
      // A consumer's credentials go with it.
      invalidate: [{ kind, parent }, ...(kind === 'consumers' ? [{ kind: 'credentials' as const }] : [])],
      success: t('delete.done', { name }),
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
      title={title}
      confirmLabel={t('delete.confirm', { kind: def.singular })}
      onConfirm={() => void confirm()}
      onCancel={() => {
        setError(undefined);
        onClose();
      }}
      body={
        <div className="list-delete">
          <p>{t('delete.body')}</p>
          {refs.length > 0 && (
            <div className="list-refs">
              <p className="list-refs__warning">
                <TriangleAlert size={14} aria-hidden="true" />
                <span>{t('delete.inUse')}</span>
              </p>
              <ul className="list-refs__list">
                {refs.map((ref) => (
                  <li key={`${ref.kind}/${ref.id}`}>
                    <Link to={pathFor(ref.kind, ref.id)}>
                      <span className="list-refs__kind">{t(`kind.${ref.kind}.singular`)}</span> {ref.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
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
