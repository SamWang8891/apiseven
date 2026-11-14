// Shown when a save finds the object changed on the server since it was loaded.
import { useMemo } from 'react';
import { stripTimestamps } from '../api/sanitize';
import type { Obj } from '../api/types';
import { t } from '../i18n';
import { Button, Dialog } from '../ui';
import { hunks, lineDiff, type Hunk } from './diff';
import { canonical, pretty } from './json';

export interface ConflictDialogProps {
  /** Kind singular and object name, for the title. */
  kind: string;
  name: string;
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
 */
export function ConflictDialog({ kind, name, loaded, theirs, onOverwrite, onReload, onCancel }: ConflictDialogProps) {
  const lines = useMemo(
    () => hunks(lineDiff(pretty(canonical(stripTimestamps(loaded))), pretty(canonical(stripTimestamps(theirs))))),
    [loaded, theirs],
  );
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
            <p className="ed-conflict__legend">{t('editor.conflict.legend')}</p>
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
