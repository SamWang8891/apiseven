// Shown when a save finds the object changed on the server since it was loaded.
import { Eye, EyeOff } from 'lucide-react';
import { useMemo } from 'react';
import { stripTimestamps } from '../api/sanitize';
import type { Kind, Obj, PluginInfo } from '../api/types';
import { t } from '../i18n';
import { redactPair } from '../plugins/secrets';
import { Button, Dialog, useReveal } from '../ui';
import { hunks, lineDiff, type Hunk } from './diff';
import { deepEqual } from './draft';
import { canonical, pretty } from './json';

/** Above this many changed or context lines the diff is not drawn: a summary says which fields differ. */
const MAX_DRAWN = 2000;

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
  const diff = useMemo(() => {
    const a = pretty(canonical(mine));
    const b = pretty(canonical(others));
    const lines = hunks(lineDiff(a, b));
    // Too many lines to draw (a huge object changed at both ends cannot be aligned and reads as all
    // removed, all added): the top-level fields that differ, by name only, instead.
    const drawn = lines.filter((line) => line.op !== 'skip').length;
    const tooLarge =
      drawn > MAX_DRAWN
        ? {
            lines: Math.max(a.split('\n').length, b.split('\n').length).toLocaleString('en-US'),
            fields: [...new Set([...Object.keys(mine), ...Object.keys(others)])]
              .filter((key) => !deepEqual(mine[key], others[key]))
              .sort()
              .join(', '),
          }
        : undefined;
    return { lines, tooLarge };
  }, [mine, others]);
  const { lines, tooLarge } = diff;
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
            {tooLarge ? (
              <p className="ed-conflict__legend">{t('editor.conflict.tooLarge', tooLarge)}</p>
            ) : (
              <div className="ed-diff mono">
                {lines.map((hunk, i) => (
                  <DiffLine key={i} hunk={hunk} />
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="ed-conflict__legend">{t('editor.conflict.timeOnly')}</p>
        )}
      </div>
    </Dialog>
  );
}
