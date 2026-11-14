import { LockKeyhole } from 'lucide-react';
import { Fragment, useMemo, type ReactNode } from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router';
import { AdminClient } from '../api/client';
import { ClientProvider } from '../api/hooks';
import { useReadOnlyKey } from '../api/write';
import { needsKey, useConnections, type SavedConnection } from '../connection/store';
import { t } from '../i18n';
import { kindFromSegment, pathFor } from '../router/paths';
import { Toaster, TooltipProvider } from '../ui';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import './shell.css';

/**
 * The frame of every page that talks to APISIX: sidebar, header, and the page in a scrolling main
 * area. Without a usable connection it sends the user to Connect.
 */
export function Shell() {
  const { active } = useConnections();
  if (!active || needsKey(active)) return <Navigate to="/connect" replace />;
  return <Frame conn={active} />;
}

function Frame({ conn }: { conn: SavedConnection }) {
  // One client per connection; its cache (plugin schemas) and the query keys are scoped to it.
  const client = useMemo(() => new AdminClient(conn), [conn]);
  return (
    <ClientProvider client={client}>
      <TooltipProvider>
        <div className="shell">
          <Sidebar />
          <Header title={<Breadcrumb />} />
          <ReadOnlyBanner />
          {/* Keyed by connection: a page never carries state over to another APISIX. */}
          <main key={conn.id} className="shell-main">
            <Outlet />
          </main>
        </div>
        <Toaster />
      </TooltipProvider>
    </ClientProvider>
  );
}

/** Stays under the header once a write was refused for the key's role (see useWrite). */
function ReadOnlyBanner() {
  if (!useReadOnlyKey()) return null;
  return (
    <div className="shell-readonly" role="status">
      <LockKeyhole size={14} strokeWidth={2.25} aria-hidden="true" />
      <span>{t('readOnly.banner')}</span>
    </div>
  );
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Kind › object, from the URL: Routes › web-home, Consumers › jo › Credentials › key-1. */
function Breadcrumb() {
  const segments = useLocation().pathname.split('/').filter(Boolean);
  const kind = kindFromSegment(segments[0]);
  if (!kind) return null;

  const crumbs: { label: ReactNode; to?: string }[] = [{ label: t(`kind.${kind}.plural`), to: pathFor(kind) }];
  const item = (raw: string, singular: string): ReactNode =>
    raw === 'new' ? t('page.new', { kind: singular }) : <span className="mono">{decode(raw)}</span>;

  if (segments[1] !== undefined) crumbs.push({ label: item(segments[1], t(`kind.${kind}.singular`)), to: `/${segments[0]}/${segments[1]}` });
  if (kind === 'consumers' && segments[2] === 'credentials' && segments[3] !== undefined) {
    crumbs.push({ label: t('kind.credentials.plural') }, { label: item(segments[3], t('kind.credentials.singular')) });
  }

  return (
    <nav aria-label={t('shell.breadcrumb')}>
      <ol className="shell-crumbs">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <Fragment key={i}>
              {i > 0 && (
                <li className="shell-crumbs__sep" aria-hidden="true">
                  /
                </li>
              )}
              <li className="shell-crumbs__item">
                {last || !c.to ? (
                  <span aria-current={last ? 'page' : undefined}>{c.label}</span>
                ) : (
                  <Link to={c.to}>{c.label}</Link>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
