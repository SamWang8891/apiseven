// The elements the route table renders: they read the URL params and key the pages by them.
import { Link, useLocation, useParams } from 'react-router';
import { t } from '../i18n';
import { EditorPage } from '../pages/EditorPage';
import { ListPage } from '../pages/ListPage';
import { registry } from '../resources/registry';
import { kindFromSegment, pathFor } from './paths';

export function NotFound() {
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

/** A kind's list: its own page when it has one (ResourceDef.ListComponent), else the generic one. */
export function ListRoute() {
  const kind = kindFromSegment(useParams().kind);
  if (!kind) return <NotFound />;
  const Own = registry[kind].ListComponent;
  return Own ? <Own key={kind} kind={kind} /> : <ListPage key={kind} kind={kind} />;
}

export function EditorRoute({ creating }: { creating?: boolean }) {
  const params = useParams();
  const kind = kindFromSegment(params.kind);
  if (!kind) return <NotFound />;
  const id = creating ? undefined : params.id;
  // Keyed, so opening another object starts a fresh page instead of reusing this one's state.
  return <EditorPage key={`${kind}/${id ?? ''}`} kind={kind} id={id} />;
}

export function CredentialRoute({ creating }: { creating?: boolean }) {
  const { username = '', id } = useParams();
  const credentialId = creating ? undefined : id;
  return <EditorPage key={`${username}/${credentialId ?? ''}`} kind="credentials" id={credentialId} parent={{ consumer: username }} />;
}
