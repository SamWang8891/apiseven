// The node table's presentational parts: the share-of-requests cell, the header row, and the plain
// table a locked editor shows (NodesTable.tsx is the editing table).
import { t } from '../i18n';
import type { NodeRow, Share } from './nodes';

/** `75%`, `<1%` for a sliver, `0%`. */
function percent(share: number): string {
  const pct = Math.round(share * 100);
  return pct === 0 && share > 0 ? '<1%' : `${pct}%`;
}

export function ShareCell({ share }: { share: Share }) {
  if (share === undefined) return <span className="up-share up-share--none">{t('ui.empty')}</span>;
  if (share === 'standby') {
    return (
      <span className="up-share up-share--standby" title={t('up.nodes.standbyTitle')}>
        {t('up.nodes.standby')}
      </span>
    );
  }
  const text = percent(share);
  return (
    <span className="up-share" title={t('up.nodes.shareTitle', { share: text })}>
      <span className="up-share__track" aria-hidden="true">
        <span className="up-share__fill" style={{ width: `${Math.min(100, share * 100)}%` }} />
      </span>
      <span className="up-share__pct">{text}</span>
    </span>
  );
}

export function Head({ priority, shares, actions }: { priority: boolean; shares: boolean; actions: boolean }) {
  return (
    <thead>
      <tr>
        <th scope="col" className="up-table__host">
          {t('up.nodes.host')}
        </th>
        <th scope="col" className="up-table__num">
          {t('up.nodes.port')}
        </th>
        <th scope="col" className="up-table__num">
          {t('up.nodes.weight')}
        </th>
        {priority && (
          <th scope="col" className="up-table__num">
            {t('up.nodes.priority')}
          </th>
        )}
        {shares && (
          <th scope="col" className="up-table__share">
            {t('up.nodes.share')}
          </th>
        )}
        {actions && (
          <th scope="col" className="up-table__actions">
            <span className="up-sr-only">{t('up.nodes.actions')}</span>
          </th>
        )}
      </tr>
    </thead>
  );
}

/** The table as it reads locked: values only; the priority column only when a node sets one. */
export function LockedNodes({ rows, shares }: { rows: NodeRow[]; shares: Share[] | undefined }) {
  if (rows.length === 0) return <p className="up-empty">{t('up.nodes.empty')}</p>;
  const priority = rows.some((row) => row.priority !== undefined);
  return (
    <table className="up-table up-table--locked">
      <Head priority={priority} shares={shares !== undefined} actions={false} />
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            <td className="up-table__host mono">{row.host ?? t('ui.empty')}</td>
            <td className="up-table__num mono">{row.port ?? t('ui.empty')}</td>
            <td className="up-table__num">{row.weight ?? t('ui.empty')}</td>
            {priority && <td className="up-table__num">{row.priority ?? 0}</td>}
            {shares && (
              <td className="up-table__share">
                <ShareCell share={shares[i]} />
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
