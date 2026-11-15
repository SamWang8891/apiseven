// "Save anyway" (Task 16 B18): local validation is never a dead end. The checks the browser makes (a
// kind's `validate`: its …Issues and the plugin schemas compiled with Ajv) can be stricter than
// APISIX: a custom plugin, a pattern JavaScript reads differently, a field holding a $secret:// or
// $env:// reference (which APISIX's validator skips), a newer APISIX. When Save was refused only for
// those, the refusal offers to send the draft as it is, and APISIX's answer decides. The frame
// (Editor.tsx) decides when that is so and sends it through its one save path; useSaveAnyway keeps
// the confirmation, asked once per editing session; this file draws the offer and the question.
import { ShieldQuestion } from 'lucide-react';
import { t } from '../i18n';
import { ConfirmDialog } from '../ui';
import type { SaveAnyway } from './useSaveAnyway';

/**
 * What the offer is, above the tabs; the action itself is Save anyway beside Save in the sticky
 * header (EditorHeader), which a refusal that scrolls to a field far down never hides. It describes
 * that button (`ed-anyway-why`).
 */
export function SaveAnywayNotice({ count }: { count: number }) {
  return (
    <section className="ed-anyway" aria-label={t('editor.anyway.title')}>
      <ShieldQuestion size={16} aria-hidden="true" />
      <div className="ed-anyway__text">
        <p className="ed-anyway__title">{t('editor.anyway.title')}</p>
        <p id="ed-anyway-why">{count === 1 ? t('editor.anyway.bodyOne') : t('editor.anyway.bodyMany', { count })}</p>
      </div>
    </section>
  );
}

/** The question, naming each problem with its tab. */
export function SaveAnywayDialog({ anyway }: { anyway: SaveAnyway }) {
  const count = anyway.issues.length;
  return (
    <ConfirmDialog
      open={anyway.asking}
      title={t('editor.anyway.confirmTitle')}
      body={
        <>
          <p>{count === 1 ? t('editor.anyway.confirmBodyOne') : t('editor.anyway.confirmBodyMany', { count })}</p>
          <ul className="ed-anyway__list">
            {anyway.issues.map((issue, i) => (
              <li key={i}>{issue.path === '' ? t('editor.anyway.item', { tab: issue.tab, message: issue.message }) : t('editor.anyway.itemAt', { tab: issue.tab, path: issue.path, message: issue.message })}</li>
            ))}
          </ul>
          <p>{t('editor.anyway.once')}</p>
        </>
      }
      confirmLabel={t('editor.anyway.confirm')}
      onConfirm={anyway.confirm}
      onCancel={anyway.cancel}
    />
  );
}
