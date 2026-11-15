import { useEffect } from 'react';
import { t } from '../i18n';

/** Sets the browser tab's title while the calling page shows (the next page sets its own). */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title;
  }, [title]);
}

/** "Routes · apiseven", "New Route · apiseven", "Not found · apiseven". */
export const pageTitle = (page: string): string => t('title.page', { page });

/** "web-home · Route · apiseven": an object's page, by its name and its kind (singular). */
export const objectTitle = (name: string, kind: string): string => t('title.object', { name, kind });
