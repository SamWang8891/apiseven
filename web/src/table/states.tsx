import { CircleAlert, Inbox, SearchX } from 'lucide-react';
import { useId } from 'react';
import type { ApiError } from '../api/errors';
import type { Kind, Parent } from '../api/types';
import { t } from '../i18n';
import { registry } from '../resources/registry';
import { Button } from '../ui';
import { NewLink } from './Toolbar';
import { useClient } from '../api/hooks';
import { useOwnUnreachable } from '../api/reachability';

/** "Can't reach the Admin API at <address>", for an error that got no answer at all. */
export function Unreached({ error, className = 'tbl-state__body' }: { error: ApiError; className?: string }) {
  const { conn } = useClient();
  if (error.kind !== 'network') return null;
  return (
    <p className={className}>
      {t('unreachable.title')} <span className="mono">{conn.baseUrl}</span>
    </p>
  );
}

/** No items at all: say so, say what the kind is for, and offer to create the first (not with a read-only key: NewLink). */
export function EmptyState({ kind, parent }: { kind: Kind; parent?: Parent }) {
  const id = useId();
  return (
    <section className="tbl-state" aria-labelledby={id}>
      <Inbox className="tbl-state__icon" size={28} strokeWidth={1.75} aria-hidden="true" />
      <h2 id={id}>{t('table.empty.title', { plural: registry[kind].plural })}</h2>
      <p className="tbl-state__body">{t(`kind.${kind}.about`)}</p>
      <NewLink kind={kind} parent={parent} />
    </section>
  );
}

/** Items exist, but the search and filters hide them all. */
export function NoMatchState({ plural, onClear }: { plural: string; onClear: () => void }) {
  const id = useId();
  return (
    <section className="tbl-state" aria-labelledby={id}>
      <SearchX className="tbl-state__icon" size={28} strokeWidth={1.75} aria-hidden="true" />
      <h2 id={id}>{t('table.empty.noMatch', { plural })}</h2>
      <p className="tbl-state__body">{t('table.empty.noMatchBody')}</p>
      <Button onClick={onClear}>{t('table.clearFilters')}</Button>
    </section>
  );
}

/**
 * The list could not be loaded (auth errors excepted: they send the app to Connect). When no answer
 * came at all it names the address too, and the shell's banner stands down (api/reachability.ts).
 */
export function ErrorState({ plural, error, onRetry }: { plural: string; error: ApiError; onRetry?: () => void }) {
  useOwnUnreachable(error);
  return (
    <div className="tbl-state tbl-state--error" role="alert">
      <CircleAlert className="tbl-state__icon" size={28} strokeWidth={1.75} aria-hidden="true" />
      <h2>{t('table.error', { plural })}</h2>
      <Unreached error={error} />
      <p className="tbl-state__message mono">{error.message}</p>
      {onRetry && <Button onClick={onRetry}>{t('table.retry')}</Button>}
    </div>
  );
}
