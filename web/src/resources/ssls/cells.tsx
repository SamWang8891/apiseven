// The SSL list's own cells (columns.tsx): the SNIs linking to the editor, what uses the
// certificate (usage.ts), and a plain line of text with its title.
import { Link } from 'react-router';
import type { Item } from '../../api/types';
import { t } from '../../i18n';
import { pathFor } from '../../router/paths';
import { Empty } from '../../table/cells';
import { Tooltip } from '../../ui';
import { UsedByCell } from '../cells';
import type { Ctx } from '../ctx';
import { sniNames, usageOf } from './usage';

/** At most this many SNIs in a cell, then `+N` with the rest in the title. */
const SHOWN_SNIS = 3;

export function SnisCell({ item }: { item: Item }) {
  const [first, ...rest] = sniNames(item.value);
  const hidden = rest.slice(SHOWN_SNIS - 1);
  return (
    <>
      <Link className="tbl-name mono" to={pathFor('ssls', item.id)} title={first ?? item.id}>
        {first ?? item.id}
      </Link>
      {rest.slice(0, SHOWN_SNIS - 1).map((sni, i) => (
        <span key={i} className="cell-sub mono" title={sni}>
          {sni}
        </span>
      ))}
      {hidden.length > 0 && (
        <span className="cell-sub" title={hidden.join('\n')}>
          {t('cell.more', { count: hidden.length })}
        </span>
      )}
    </>
  );
}

/** Route hosts listed in the tooltip before "and N more". */
const SHOWN_HOSTS = 8;

/**
 * What uses the certificate: for a server one, how many route hosts it is presented for, listed in
 * a tooltip (a host another certificate shares marked so); for a client one, the objects naming it.
 */
export function UsageCell({ item, ctx }: { item: Item; ctx: Ctx }) {
  const usage = usageOf(item, ctx);
  if (!usage) return <span className="cell-muted">{t('picker.loading')}</span>;
  if (usage.type === 'unknown') return <span className="cell-muted">{t('cell.usedBy.unknown')}</span>;
  if (usage.type === 'client') return <UsedByCell refs={usage.refs} />;
  const { hosts } = usage;
  if (hosts.length === 0) return <span className="cell-muted">{t('ssl.usedBy.noHost')}</span>;
  const more = hosts.length - SHOWN_HOSTS;
  return (
    <Tooltip
      content={
        <span className="cell-tip-list">
          {hosts.slice(0, SHOWN_HOSTS).map(({ host, others }) => (
            <span key={host}>
              <span className="mono">{host}</span>
              {others > 0 && <span className="cell-tip-note"> {others === 1 ? t('ssl.usedBy.sharedOne') : t('ssl.usedBy.shared', { count: others })}</span>}
            </span>
          ))}
          {more > 0 && <span className="cell-tip-note">{t('cell.usedByMore', { count: more })}</span>}
        </span>
      }
    >
      <button type="button" className="tbl-more cell-count" aria-label={hosts.length === 1 ? t('ssl.usedBy.hostsOne') : t('ssl.usedBy.hosts', { count: hosts.length })}>
        {hosts.length}
      </button>
    </Tooltip>
  );
}

export function NameText({ text, mono }: { text: string | undefined; mono?: boolean }) {
  if (text === undefined) return <Empty />;
  return (
    <span className={mono ? 'tbl-line mono' : 'tbl-line'} title={text}>
      {text}
    </span>
  );
}
