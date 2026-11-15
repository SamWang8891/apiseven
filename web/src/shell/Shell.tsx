import { LockKeyhole } from 'lucide-react';
import { Fragment, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router';
import { AdminClient } from '../api/client';
import { ClientProvider } from '../api/hooks';
import { useReadOnlyKey } from '../api/write';
import { needsKey, useConnections, type SavedConnection } from '../connection/store';
import { t } from '../i18n';
import { kindFromSegment, NEW_SEGMENT, pathFor } from '../router/paths';
import { Toaster, TooltipProvider } from '../ui';
import { clipTitle } from '../ui/clipTitle';
import { setToastPage } from '../ui/toast';
import { Header, SearchTrigger } from './Header';
import { lazyPalette } from './PaletteLoader';
import { Sidebar } from './Sidebar';
import { UnreachableBanner } from './UnreachableBanner';
import { usePalette } from './usePalette';
import './shell.css';

// The palette and its search load on first open; the hotkey, the header button and the load boundary
// are all the entry holds.
const CommandPalette = lazyPalette(() => import('./CommandPalette'));

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
        <Body connId={conn.id} />
        <Toaster />
      </TooltipProvider>
    </ClientProvider>
  );
}

function Body({ connId }: { connId: string }) {
  const main = useRef<HTMLElement>(null);
  const palette = usePalette(main);
  // Before the new page's effects run, so what it raises belongs to it; a refusal from the last page goes.
  const { pathname } = useLocation();
  useLayoutEffect(() => setToastPage(pathname), [pathname]);
  return (
    <>
      <div className="shell">
        <Sidebar />
        <Header title={<Breadcrumb />} search={<SearchTrigger onOpen={palette.show} />} />
        <div className="shell-banners">
          <UnreachableBanner />
          <ReadOnlyBanner />
        </div>
        {/* Keyed by connection: a page never carries state over to another APISIX. Focusable, for the
            page the palette opens. */}
        <main key={connId} ref={main} className="shell-main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
      {palette.open && <CommandPalette onClose={palette.close} />}
    </>
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

  // `text`: the crumb as plain text, its title while a narrow header cuts it off. `id`: an object's id,
  // which gives way first; the kinds' names keep their width.
  const crumbs: { label: ReactNode; text: string; to?: string; id?: boolean }[] = [{ label: t(`kind.${kind}.plural`), text: t(`kind.${kind}.plural`), to: pathFor(kind) }];
  const item = (raw: string, singular: string): { label: ReactNode; text: string; id?: boolean } =>
    raw === NEW_SEGMENT ? { label: t('page.new', { kind: singular }), text: t('page.new', { kind: singular }) } : { label: <span className="mono">{decode(raw)}</span>, text: decode(raw), id: true };

  if (segments[1] !== undefined) crumbs.push({ ...item(segments[1], t(`kind.${kind}.singular`)), to: `/${segments[0]}/${segments[1]}` });
  if (kind === 'consumers' && segments[2] === 'credentials' && segments[3] !== undefined) {
    crumbs.push(
      { label: t('kind.credentials.plural'), text: t('kind.credentials.plural'), to: `/${segments[0]}/${segments[1]}?tab=credentials` },
      item(segments[3], t('kind.credentials.singular')),
    );
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
              <li className={c.id ? 'shell-crumbs__item shell-crumbs__item--id' : 'shell-crumbs__item'} {...clipTitle(c.text)}>
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
