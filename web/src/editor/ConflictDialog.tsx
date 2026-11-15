// Shown when a save finds the object changed on the server since it was loaded.
import { Eye, EyeOff } from 'lucide-react';
import { useMemo } from 'react';
import { stripTimestamps } from '../api/sanitize';
import type { Kind, Obj, PluginInfo } from '../api/types';
import { t } from '../i18n';
import { redactPair } from '../plugins/secrets';
import { Button, Dialog, useReveal } from '../ui';
import { hunks, lineDiff, type Hunk } from './diff';
import { canonical, pretty } from './json';

export interface ConflictDialogProps {
  /** Kind singular and object name, for the title. */
  kind: string;
  name: string;
  /** The object's kind, and its scope's plugin list (undefined while loading): which values are secret. */
  resource: Kind;
  plugins: Record<string, PluginInfo> | undefined;
  /** The object's id: what masks a plugin metadata or secret manager entry whose body has none. */
  id?: string;
  /** The stored value the draft was loaded from, and the server's current one. */
  loaded: Obj;
  theirs: Obj;
  onOverwrite: () => void;
  onReload: () => void;
  onCancel: () => void;
}

function DiffLine({ hunk }: { hunk: Hunk }) {
  if (hunk.op === 'skip') return <div className="ed-diff__skip">{t('editor.conflict.skipped', { count: hunk.count })}</div>;
  // <del> / <ins> carry removed / added to assistive tech; the sign and colour show it on screen.
  const text = <span className="ed-diff__text">{hunk.text}</span>;
  if (hunk.op === 'del') {
    return (
      <del className="ed-diff__line ed-diff__line--del">
        <span className="ed-diff__mark" aria-hidden="true">
          −
        </span>
        {text}
      </del>
    );
  }
  if (hunk.op === 'add') {
    return (
      <ins className="ed-diff__line ed-diff__line--add">
        <span className="ed-diff__mark" aria-hidden="true">
          +
        </span>
        {text}
      </ins>
    );
  }
  return (
    <div className="ed-diff__line">
      <span className="ed-diff__mark" aria-hidden="true" />
      {text}
    </div>
  );
}

/**
 * Someone else saved the object after it was loaded. Shows what changed between the loaded version
 * and theirs (pretty JSON with sorted keys, timestamps left out, unchanged stretches folded) and lets the user keep
 * their draft by overwriting, take the server's version, or go back to editing.
 * Secrets on both sides are masked as in the locked JSON view (redactPair), behind "Show secrets"; a
 * masked value that differs reads "(changed)" on their side. Only the display is masked: Overwrite
 * saves the draft and Reload takes the server's item, both with their real values.
 */
export function ConflictDialog({ kind, name, resource, plugins, id, loaded, theirs, onOverwrite, onReload, onCancel }: ConflictDialogProps) {
  const pair = useMemo(() => redactPair(stripTimestamps(loaded), stripTimestamps(theirs), resource, plugins, id), [loaded, theirs, resource, plugins, id]);
  const [revealed, setRevealed] = useReveal();
  const [mine, others] = revealed ? pair.revealed : pair.masked;
  const lines = useMemo(() => hunks(lineDiff(pretty(canonical(mine)), pretty(canonical(others)))), [mine, others]);
  const changed = lines.some((line) => line.op === 'add' || line.op === 'del');
  return (
    <Dialog
      open
      size="lg"
      onClose={onCancel}
      title={t('editor.conflict.title', { kind, name })}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {t('ui.cancel')}
          </Button>
          <Button onClick={onReload}>{t('editor.conflict.reload')}</Button>
          <Button variant="danger" onClick={onOverwrite}>
            {t('editor.conflict.overwrite')}
          </Button>
        </>
      }
    >
      <div className="ed-conflict">
        <p>{t('editor.conflict.body')}</p>
        {changed ? (
          <>
            <div className="ed-conflict__bar">
              <p className="ed-conflict__legend">{t('editor.conflict.legend')}</p>
              {pair.revealable && (
                <Button size="sm" variant="ghost" icon={revealed ? <EyeOff size={13} /> : <Eye size={13} />} aria-pressed={revealed} onClick={() => setRevealed((r) => !r)}>
                  {revealed ? t('pl.card.secrets.hide') : t('pl.card.secrets.show')}
                </Button>
              )}
            </div>
            <div className="ed-diff mono">
              {lines.map((hunk, i) => (
                <DiffLine key={i} hunk={hunk} />
              ))}
            </div>
          </>
        ) : (
          <p className="ed-conflict__legend">{t('editor.conflict.timeOnly')}</p>
        )}
      </div>
    </Dialog>
  );
}
