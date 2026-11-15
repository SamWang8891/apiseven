// The elements the route table renders: they read the URL params and key the pages by them.
import { ArrowLeft, SearchX } from 'lucide-react';
import { Link, Navigate, useLocation, useParams } from 'react-router';
import { useItem } from '../api/hooks';
import { idSegments, isSegment } from '../api/segments';
import type { Kind, Parent } from '../api/types';
import { t } from '../i18n';
import { EditorPage } from '../pages/EditorPage';
import { ListPage } from '../pages/ListPage';
import { registry } from '../resources/registry';
import { pageTitle, useDocumentTitle } from '../shell/documentTitle';
import { kindFromSegment, newPathFor, OLD_NEW_SEGMENT, pathFor } from './paths';

/** No page at this address (or an id that is not one path segment): say so, and lead back to the kind's list (Routes when none is named). */
export function NotFound() {
  const { pathname } = useLocation();
  useDocumentTitle(pageTitle(t('notFound.title')));
  const kind = kindFromSegment(pathname.split('/')[1]) ?? 'routes';
  return (
    <div className="shell-state">
      <SearchX className="shell-state__icon" size={28} strokeWidth={1.75} aria-hidden="true" />
      <h1>{t('notFound.title')}</h1>
      <p className="shell-state__body">
        {t('notFound.body')} <code className="mono">{pathname}</code>
      </p>
      <Link className="shell-state__link" to={pathFor(kind)}>
        <ArrowLeft size={14} aria-hidden="true" />
        {t('notFound.back', { plural: registry[kind].plural })}
      </Link>
    </div>
  );
}

/** A kind's list: its own page when it has one (ResourceDef.ListComponent), else the generic one. */
export function ListRoute() {
  const kind = kindFromSegment(useParams().kind);
  if (!kind) return <NotFound />;
  const Own = registry[kind].ListComponent;
  return Own ? <Own key={kind} kind={kind} /> : <ListPage key={kind} kind={kind} />;
}

/**
 * The create page's old address (…/new, paths.ts OLD_NEW_SEGMENT): the object whose id is "new" when
 * APISIX has one, else the create page at its address now, with the same search (?from=, prefills).
 * A secret's id has two parts, so "new" is none: the create page at once.
 */
function OldNewRoute({ kind, parent }: { kind: Kind; parent?: Parent }) {
  const { search } = useLocation();
  const addressable = idSegments(kind, OLD_NEW_SEGMENT) !== undefined;
  const query = useItem(kind, addressable ? OLD_NEW_SEGMENT : undefined, parent);
  if (!addressable || (query.error?.status === 404 && !query.data)) return <Navigate to={{ pathname: newPathFor(kind, parent), search }} replace />;
  return <EditorPage kind={kind} id={OLD_NEW_SEGMENT} parent={parent} />;
}

export function EditorRoute({ creating }: { creating?: boolean }) {
  const params = useParams();
  const kind = kindFromSegment(params.kind);
  if (!kind) return <NotFound />;
  const id = creating ? undefined : params.id;
  if (id === OLD_NEW_SEGMENT) return <OldNewRoute key={kind} kind={kind} />;
  // An id that would not stay one path segment (decoded: "r1/x", "..") names no object (api/segments.ts).
  if (id !== undefined && !idSegments(kind, id)) return <NotFound />;
  // Keyed, so opening another object starts a fresh page instead of reusing this one's state.
  return <EditorPage key={`${kind}/${id ?? ''}`} kind={kind} id={id} />;
}

export function CredentialRoute({ creating }: { creating?: boolean }) {
  const { username = '', id } = useParams();
  const credentialId = creating ? undefined : id;
  // The consumer comes from the URL as well: it is judged like the id, or the page would name one object and write another.
  if (!isSegment(username) || (credentialId !== undefined && !isSegment(credentialId))) return <NotFound />;
  if (credentialId === OLD_NEW_SEGMENT) return <OldNewRoute key={username} kind="credentials" parent={{ consumer: username }} />;
  return <EditorPage key={`${username}/${credentialId ?? ''}`} kind="credentials" id={credentialId} parent={{ consumer: username }} />;
}
