// How many credentials a consumer has, for its row in a list: fetched when the row is shown (one
// request per consumer on the page, cached and shared with its Credentials tab), "…" meanwhile.
import { useMemo } from 'react';
import { useList } from '../../api/hooks';
import { t } from '../../i18n';
import { Tooltip } from '../../ui';

export function CredentialCount({ username }: { username: string }) {
  const parent = useMemo(() => ({ consumer: username }), [username]);
  const list = useList('credentials', parent);
  if (list.data) return <span className="tbl-line cell-count">{list.data.length}</span>;
  if (list.isError) {
    return (
      <Tooltip content={t('shell.countFailed', { error: list.error.message })}>
        <span className="tbl-line cell-count cell-count--error" tabIndex={0} aria-label={t('shell.countFailed', { error: list.error.message })}>
          !
        </span>
      </Tooltip>
    );
  }
  return (
    <span className="tbl-line cell-muted" aria-label={t('picker.loading')}>
      …
    </span>
  );
}
