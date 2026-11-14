import { lazy, Suspense } from 'react';
import { createHashRouter, Link, Navigate, useLocation, useParams, type RouteObject } from 'react-router';
import { useList } from '../api/hooks';
import type { Kind, Parent } from '../api/types';
import { ConnectPage } from '../connection/ConnectPage';
import { t } from '../i18n';
import { RouteErrorPage } from '../shell/ErrorPage';
import { Shell } from '../shell/Shell';
import { TooltipProvider } from '../ui';
import { kindFromSegment, pathFor } from './paths';

// The UI kit showcase, in development builds only (the import is dropped from production bundles).
const Gallery = import.meta.env.DEV ? lazy(() => import('../ui/Gallery')) : null;

/** Placeholder list page (Task 5 replaces it): the kind, its count, and links to each object. */
export function ListPlaceholder({ kind, parent }: { kind: Kind; parent?: Parent }) {
  const list = useList(kind, parent);
  return (
    <div className="shell-page">
      <div className="shell-page__head">
        <h1>{t(`kind.${kind}.plural`)}</h1>
      </div>
      <p>{list.data ? t('page.count', { count: list.data.length }) : list.error ? list.error.message : t('ui.empty')}</p>
      {list.data && list.data.length > 0 && (
        <ul className="shell-placeholder">
          {list.data.map((item) => (
            <li key={item.id}>
              <Link className="mono" to={pathFor(kind, item.id, parent)}>
                {item.id}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="shell-note">{t('page.placeholder')}</p>
    </div>
  );
}

/** Placeholder editor page (Task 7 replaces it). `id` is decoded; undefined on the create page. */
export function EditorPlaceholder({ kind, id, parent }: { kind: Kind; id?: string; parent?: Parent }) {
  const list = useList(kind, parent);
  const singular = t(`kind.${kind}.singular`);
  return (
    <div className="shell-page">
      <div className="shell-page__head">
        <h1>{id === undefined ? t('page.new', { kind: singular }) : singular}</h1>
      </div>
      <dl className="shell-facts">
        {parent && (
          <>
            <dt>{t('page.consumer')}</dt>
            <dd className="mono">{parent.consumer}</dd>
          </>
        )}
        {id !== undefined && (
          <>
            <dt>{t('page.id')}</dt>
            <dd className="mono">{id}</dd>
          </>
        )}
        <dt>{t(`kind.${kind}.plural`)}</dt>
        <dd>{list.data ? t('page.count', { count: list.data.length }) : t('ui.empty')}</dd>
      </dl>
      <p className="shell-note">{t('page.placeholder')}</p>
    </div>
  );
}

function NotFound() {
  const { pathname } = useLocation();
  return (
    <div className="shell-page">
      <div className="shell-page__head">
        <h1>{t('notFound.title')}</h1>
      </div>
      <p>
        {t('notFound.body')} <code className="mono">{pathname}</code>
      </p>
      <p className="shell-note">
        <Link to={pathFor('routes')}>{t('notFound.back')}</Link>
      </p>
    </div>
  );
}

function ListRoute() {
  const kind = kindFromSegment(useParams().kind);
  return kind ? <ListPlaceholder key={kind} kind={kind} /> : <NotFound />;
}

function EditorRoute({ creating }: { creating?: boolean }) {
  const params = useParams();
  const kind = kindFromSegment(params.kind);
  if (!kind) return <NotFound />;
  const id = creating ? undefined : params.id;
  // Keyed, so opening another object starts a fresh page instead of reusing this one's state.
  return <EditorPlaceholder key={`${kind}/${id ?? ''}`} kind={kind} id={id} />;
}

function CredentialRoute({ creating }: { creating?: boolean }) {
  const { username = '', id } = useParams();
  const credentialId = creating ? undefined : id;
  return <EditorPlaceholder key={`${username}/${credentialId ?? ''}`} kind="credentials" id={credentialId} parent={{ consumer: username }} />;
}

const routes: RouteObject[] = [
  {
    path: '/',
    errorElement: <RouteErrorPage />,
    children: [
      { path: 'connect', element: <ConnectPage /> },
      ...(Gallery
        ? [
            {
              path: '__kit',
              element: (
                <TooltipProvider>
                  <Suspense fallback={null}>
                    <Gallery />
                  </Suspense>
                </TooltipProvider>
              ),
            },
          ]
        : []),
      {
        element: <Shell />,
        children: [
          {
            // Errors inside a page render in the shell's main area; the sidebar and header stay.
            errorElement: <RouteErrorPage />,
            children: [
              { index: true, element: <Navigate to={pathFor('routes')} replace /> },
              { path: ':kind', element: <ListRoute /> },
              { path: ':kind/new', element: <EditorRoute creating /> },
              { path: ':kind/:id', element: <EditorRoute /> },
              { path: 'consumers/:username/credentials/new', element: <CredentialRoute creating /> },
              { path: 'consumers/:username/credentials/:id', element: <CredentialRoute /> },
              { path: '*', element: <NotFound /> },
            ],
          },
        ],
      },
    ],
  },
];

/**
 * The app's hash router: #/connect, #/:kind, #/:kind/new, #/:kind/:id,
 * #/consumers/:username/credentials/new|:id, and #/__kit in development.
 */
// eslint-disable-next-line react-refresh/only-export-components -- the route table lives beside the placeholder pages it renders (Tasks 5 and 7 replace them)
export function createAppRouter() {
  return createHashRouter(routes);
}
