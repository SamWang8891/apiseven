// How many credentials a consumer has, for its row in a list: fetched when the row is shown (one
// request per consumer on the page, cached and shared with its Credentials tab, not refetched when
// the window regains focus), "…" meanwhile. On an APISIX without credentials (before 3.11) nothing is
// asked and the cell reads "—"; when that check itself failed, the list is asked anyway (its own
// answer or error shows), never an endless "…". The glyphs are hidden from screen readers, which hear
// the words.
import { useMemo } from 'react';
import { useList, useSupportsStatus } from '../../api/hooks';
import { t } from '../../i18n';
import { Empty } from '../../table/cells';
import { Tooltip } from '../../ui';

export function CredentialCount({ username }: { username: string }) {
  const supported = useSupportsStatus('credentials');
  const parent = useMemo(() => ({ consumer: username }), [username]);
  const list = useList('credentials', parent, { enabled: supported === 'yes' || supported === 'failed', refetchOnWindowFocus: false });
  if (supported === 'no') return <Empty />;
  if (list.data) return <span className="tbl-line cell-count">{list.data.length}</span>;
  if (list.isError) {
    const why = t('shell.countFailed', { error: list.error.message });
    return (
      <Tooltip content={why}>
        <span className="tbl-line cell-count cell-count--error" tabIndex={0}>
          <span aria-hidden="true">!</span>
          <span className="ui-sr-only">{why}</span>
        </span>
      </Tooltip>
    );
  }
  return (
    <span className="tbl-line cell-muted">
      <span aria-hidden="true">…</span>
      <span className="ui-sr-only">{t('picker.loading')}</span>
    </span>
  );
}
