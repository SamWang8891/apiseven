// What the editor page shows instead of an object: while it loads, when it doesn't exist, when the read failed.
import { ArrowLeft, CircleAlert, SearchX } from 'lucide-react';
import { Link } from 'react-router';
import type { ApiError } from '../api/errors';
import type { Kind, Parent } from '../api/types';
import { t } from '../i18n';
import { registry } from '../resources/registry';
import { Button } from '../ui';
import { objectTitle, pageTitle, useDocumentTitle } from '../shell/documentTitle';
import { backOf } from './back';

/** The header and body outlines while the object loads. */
export function EditorSkeleton({ kind, id }: { kind: Kind; id?: string }) {
  useDocumentTitle(id === undefined ? pageTitle(t('page.new', { kind: registry[kind].singular })) : objectTitle(id, registry[kind].singular));
  return (
    <div className="ed" role="status" aria-busy="true" aria-label={t('editor.loading', { kind: registry[kind].singular })}>
      <div className="ed-head">
        <div className="ed-skel">
          <span className="ed-skel__bar ed-skel__bar--title" />
          <span className="ed-skel__bar ed-skel__bar--meta" />
        </div>
      </div>
      <div className="ed-body">
        <div className="ed-skel">
          <span className="ed-skel__bar ed-skel__bar--tabs" />
          <span className="ed-skel__bar ed-skel__bar--block" />
        </div>
      </div>
    </div>
  );
}

/** The object (or the one to copy) doesn't exist: say which, and offer the way back. */
export function NotFoundState({ kind, id, parent, copying }: { kind: Kind; id: string; parent?: Parent; copying?: boolean }) {
  const back = backOf(kind, parent);
  const singular = registry[kind].singular;
  useDocumentTitle(pageTitle(t('notFound.title')));
  return (
    <div className="ed-state">
      <SearchX className="ed-state__icon" size={28} strokeWidth={1.75} aria-hidden="true" />
      <h1>{t('editor.notFound.title', { kind: singular, id })}</h1>
      <p className="ed-state__body">{copying ? t('editor.notFound.copyBody', { kind: singular }) : t('editor.notFound.body')}</p>
      <Link className="ed-state__link" to={back.to}>
        <ArrowLeft size={14} aria-hidden="true" />
        {back.label}
      </Link>
    </div>
  );
}

/** The read failed for another reason (auth errors excepted: they send the app to Connect). */
export function LoadErrorState({ kind, id, error, retrying, onRetry }: { kind: Kind; id: string; error: ApiError; retrying: boolean; onRetry: () => void }) {
  useDocumentTitle(objectTitle(id, registry[kind].singular));
  return (
    <div className="ed-state ed-state--error" role="alert">
      <CircleAlert className="ed-state__icon" size={28} strokeWidth={1.75} aria-hidden="true" />
      <h1>{t('editor.loadFailed', { kind: registry[kind].singular, id })}</h1>
      <p className="ed-state__message mono">{error.message}</p>
      <Button onClick={onRetry} loading={retrying}>
        {t('table.retry')}
      </Button>
    </div>
  );
}
