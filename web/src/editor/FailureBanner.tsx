// The banner above the tabs saying why the last save didn't happen (failure.ts).
import { CircleAlert } from 'lucide-react';
import { Link } from 'react-router';
import { t } from '../i18n';
import type { Failure } from './failure';

export function FailureBanner({ failure }: { failure: Failure }) {
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
      </div>
    </div>
  );
}
