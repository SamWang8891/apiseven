import { useId } from 'react';
import { Link, NavLink } from 'react-router';
import { useList, useSupports } from '../api/hooks';
import type { Kind } from '../api/types';
import { t } from '../i18n';
import { pathFor } from '../router/paths';
import { Tooltip } from '../ui';

/** Sidebar groups, in order. Credentials have no entry: they live under their consumer. */
const GROUPS: { label: string; kinds: Kind[] }[] = [
  { label: 'nav.traffic', kinds: ['routes', 'stream_routes', 'services', 'upstreams'] },
  { label: 'nav.access', kinds: ['consumers', 'consumer_groups', 'ssls', 'secrets'] },
  { label: 'nav.plugins', kinds: ['global_rules', 'plugin_configs', 'plugin_metadata'] },
  { label: 'nav.other', kinds: ['protos'] },
];

export function Sidebar() {
  return (
    <aside className="shell-sidebar">
      <Link to={pathFor('routes')} className="shell-brand" aria-label={t('shell.home')}>
        {t('app.name')}
      </Link>
      <nav className="shell-nav" aria-label={t('shell.nav')}>
        {GROUPS.map((group) => (
          <Group key={group.label} label={t(group.label)} kinds={group.kinds} />
        ))}
      </nav>
    </aside>
  );
}

function Group({ label, kinds }: { label: string; kinds: Kind[] }) {
  const id = useId();
  return (
    <div className="shell-nav__group">
      <div className="shell-nav__heading" id={id}>
        {label}
      </div>
      <ul className="shell-nav__list" aria-labelledby={id}>
        {kinds.map((kind) => (
          <Entry key={kind} kind={kind} />
        ))}
      </ul>
    </div>
  );
}

/** Hidden once the connected APISIX turns out not to have the kind; shown while that is unknown. */
function Entry({ kind }: { kind: Kind }) {
  if (useSupports(kind) === false) return null;
  return (
    <li>
      <NavLink to={pathFor(kind)} className="shell-nav__link">
        <span className="shell-nav__label">{t(`kind.${kind}.plural`)}</span> <Count kind={kind} />
      </NavLink>
    </li>
  );
}

function Count({ kind }: { kind: Kind }) {
  const list = useList(kind);
  // An auth error is not shown here: it sends the whole app back to Connect.
  if (list.isError && list.error.kind !== 'auth') {
    return (
      <Tooltip content={list.error.message}>
        <span className="shell-nav__count shell-nav__count--error">
          <span aria-hidden="true">!</span>
          <span className="shell-sr-only">{t('shell.countFailed', { error: list.error.message })}</span>
        </span>
      </Tooltip>
    );
  }
  return <span className="shell-nav__count">{list.data ? list.data.length : '…'}</span>;
}
