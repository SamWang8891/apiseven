// The banner above the tabs saying why the last save didn't happen (failure.ts).
import { CircleAlert } from 'lucide-react';
import { Link } from 'react-router';
import type { Item } from '../api/types';
import { t } from '../i18n';
import { Button } from '../ui';
import type { Failure } from './failure';

/** `onShow`: shows what holds a refused create's id on this page (Failure.holder), dropping the draft. */
export function FailureBanner({ failure, onShow }: { failure: Failure; onShow: (holder: Item) => void }) {
  const { holder } = failure;
  return (
    <div className="ed-banner" role="alert">
      <CircleAlert size={16} aria-hidden="true" />
      <div className="ed-banner__text">
        <p className="ed-banner__title">{failure.title ?? t('editor.rejected')}</p>
        {/* APISIX's own message is shown verbatim, in mono; the editor's is a sentence. */}
        <p className={failure.title ? 'ed-banner__message' : 'ed-banner__message mono'}>{failure.message}</p>
        {failure.link && (
          <Link className="ed-banner__link" to={failure.link.to}>
            {failure.link.label}
          </Link>
        )}
        {holder && (
          <Button size="sm" onClick={() => onShow(holder)}>
            {t('editor.taken.show')}
          </Button>
        )}
      </div>
    </div>
  );
}
