import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, CircleAlert, Server, Trash2, TriangleAlert } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { AdminClient } from '../api/client';
import { refusalTitle, type ApiError } from '../api/errors';
import type { Connection } from '../api/types';
import logo from '../assets/logo.png';
import { t } from '../i18n';
import { Badge, Button, Checkbox, ConfirmDialog, Input } from '../ui';
import { needsKey, useConnections, type SavedConnection } from './store';
import { hostOf, isMixedContent, normalizeAdminUrl } from './url';
import { pageTitle, useDocumentTitle } from '../shell/documentTitle';
import './connect.css';

/** Router state of a redirect here after a read failed with an auth error. */
export interface ConnectState {
  reason?: string;
  /** The connection whose key was rejected. */
  connId?: string;
}

/**
 * Where a connection is made: Admin API URL + key, checked with a ping before it is saved. Also
 * where the app lands when a key is missing or rejected. Server-managed mode asks only for the key,
 * or, when the server holds the key, has no form at all.
 */
export function ConnectPage() {
  const { serverManaged, keyRequired } = useConnections();
  const state = useLocation().state as ConnectState | null;
  useDocumentTitle(pageTitle(t('connect.title')));
  if (serverManaged && !keyRequired) {
    return state?.reason ? <ServerKeyRejected reason={state.reason} /> : <Navigate to="/routes" replace />;
  }
  return <ConnectScreen reason={state?.reason} reasonConnId={state?.connId} />;
}

function ConnectScreen({ reason, reasonConnId }: { reason?: string; reasonConnId?: string }) {
  const { list, active, serverManaged } = useConnections();
  const navigate = useNavigate();
  // "Use another connection" leaves the connection this page was asking a key for.
  const [dismissed, setDismissed] = useState(false);
  const rejected = reasonConnId === undefined ? undefined : list.find((c) => c.id === reasonConnId);
  const target = serverManaged || dismissed ? undefined : (rejected ?? (active && needsKey(active) ? active : undefined));
  const backTo = !serverManaged && !target && active && !needsKey(active) ? active : undefined;

  return (
    <div className="connect">
      <div className="connect-column">
        <div className="connect-top">
          <Brand />
          {backTo && (
            <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} />} onClick={() => void navigate('/routes')}>
              {t('connect.back', { name: backTo.name })}
            </Button>
          )}
        </div>
        <h1 tabIndex={-1}>{t('connect.title')}</h1>
        <p className="connect-intro">
          {target ? t('connect.keyFor', { name: target.name }) : serverManaged ? t('connect.keyFor', { name: location.host }) : t('connect.intro')}
        </p>
        {/* Only while the rejected connection still exists: Back after a fix must not show a stale reason. */}
        {reason && rejected && !dismissed && <Alert title={t('connect.reason.auth')} detail={reason} />}
        <ConnectForm key={target?.id ?? 'new'} target={target} onOther={() => setDismissed(true)} />
        {!serverManaged && !target && list.length > 0 && <SavedList onUse={() => setDismissed(false)} />}
        {!serverManaged && <p className="connect-note">{t('connect.note')}</p>}
      </div>
    </div>
  );
}

/** The app's name with the logo before it; the logo is decoration, the name is the text. */
function Brand() {
  return (
    <span className="connect-brand">
      <img className="connect-brand__logo" src={logo} width={44} height={44} alt="" />
      {t('app.name')}
    </span>
  );
}

function Alert({ title, detail, hints = [] }: { title: string; detail?: string; hints?: string[] }) {
  return (
    <div className="connect-alert" role="alert">
      <CircleAlert className="connect-alert__icon" aria-hidden="true" size={16} strokeWidth={2.25} />
      <div>
        <p className="connect-alert__title">{title}</p>
        {detail && <p className="connect-alert__detail mono">{detail}</p>}
        {hints.map((hint) => (
          <p key={hint} className="connect-alert__hint">
            {hint}
          </p>
        ))}
      </div>
    </div>
  );
}

function SubmitError({ error, baseUrl }: { error: ApiError; baseUrl: string }) {
  switch (error.kind) {
    case 'auth':
      return <Alert title={t('connect.badKey')} detail={error.errorMsg} />;
    case 'server':
      return <Alert title={error.refusal ? refusalTitle(error.refusal) : t('api.server.refused')} detail={error.refusal?.message} />;
    case 'network':
      // apiseven's server could not reach APISIX: this browser's address and CORS do not matter.
      if (error.refusal) return <Alert title={t('api.server.upstream')} detail={error.refusal.message} />;
      return (
        <Alert
          title={t('connect.network', { url: `${baseUrl}/apisix/admin` })}
          hints={isMixedContent(baseUrl) ? [t('connect.mixedContent'), t('connect.networkHint')] : [t('connect.networkHint')]}
        />
      );
    default:
      if (error.v2Format) return <Alert title={t('connect.adminApiV2')} hints={[t('connect.adminApiV2Hint')]} />;
      // A parse error without a status was a 200 whose body wasn't a list.
      return <Alert title={t('connect.notAdmin', { status: `HTTP ${error.status ?? 200}` })} detail={error.errorMsg} />;
  }
}

/** The form. With a `target`, only the key is asked for, and success replaces that saved connection. */
function ConnectForm({ target, onOther }: { target?: SavedConnection; onOther: () => void }) {
  const { add, remove, serverManaged, keyRequired, serverBaseUrl } = useConnections();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  // Asking again for a key that was kept for one tab only keeps that choice.
  const [remember, setRemember] = useState(!target?.sessionOnly);
  const [urlError, setUrlError] = useState<string>();
  const [keyError, setKeyError] = useState<string>();
  const check = useMutation<{ version?: string }, ApiError, Omit<Connection, 'id'>>({
    mutationFn: (conn) => new AdminClient({ id: 'connect-check', ...conn }).ping(),
  });

  const normalized = normalizeAdminUrl(url);
  const typedUrl = 'url' in normalized ? normalized.url : undefined;
  const askUrl = !serverManaged && !target;
  const shownTarget = target ?? (serverManaged ? { name: location.host, baseUrl: `${serverBaseUrl ?? ''}/apisix/admin` } : undefined);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    let conn: Omit<Connection, 'id'>;
    if (askUrl) {
      if ('error' in normalized) {
        setUrlError(normalized.error === 'required' ? t('connect.urlRequired') : t('connect.urlInvalid'));
        return;
      }
      conn = { name: name.trim() || hostOf(normalized.url), baseUrl: normalized.url };
    } else {
      conn = target ? { name: target.name, baseUrl: target.baseUrl } : { name: location.host, baseUrl: serverBaseUrl ?? '' };
    }
    const trimmedKey = key.trim();
    if (!askUrl && trimmedKey === '') {
      setKeyError(t('connect.keyRequired'));
      return;
    }
    if (trimmedKey !== '') conn.key = trimmedKey;
    check.mutate(conn, {
      onSuccess: () => {
        // A changed key is a new connection (new id), so no cached answer of the old one is reused.
        if (target) remove(target.id);
        add(conn, remember);
        void navigate('/routes');
      },
    });
  };

  return (
    <form className="connect-form" noValidate onSubmit={submit}>
      {shownTarget && (
        <div className="connect-target">
          {serverManaged && <Server aria-hidden="true" size={14} className="connect-target__icon" />}
          <span className="connect-target__name">{shownTarget.name}</span>
          <span className="connect-target__url mono">{shownTarget.baseUrl}</span>
        </div>
      )}
      {askUrl && (
        <>
          <Input
            label={t('connect.url')}
            mono
            value={url}
            placeholder={t('connect.urlPlaceholder')}
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            autoFocus
            error={urlError}
            help={
              typedUrl ? (
                <>
                  {t('connect.urlHelp')}{' '}
                  <span className="connect-request">{t('connect.request', { url: `${typedUrl}/apisix/admin/routes` })}</span>
                </>
              ) : (
                t('connect.urlHelpEmpty')
              )
            }
            onChange={(e) => {
              setUrl(e.target.value);
              setUrlError(undefined);
            }}
          />
          {typedUrl && isMixedContent(typedUrl) && (
            <p className="connect-warn">
              <TriangleAlert aria-hidden="true" size={14} strokeWidth={2.25} />
              {t('connect.mixedContent')}
            </p>
          )}
          <Input
            label={t('connect.name')}
            value={name}
            placeholder={typedUrl ? hostOf(typedUrl) : undefined}
            help={t('connect.nameHelp')}
            autoComplete="off"
            onChange={(e) => setName(e.target.value)}
          />
        </>
      )}
      <Input
        label={t('connect.key')}
        secret
        mono
        value={key}
        required={!askUrl || keyRequired}
        autoFocus={!askUrl}
        error={keyError}
        help={t('connect.keyHelp')}
        onChange={(e) => {
          setKey(e.target.value);
          setKeyError(undefined);
        }}
      />
      <Checkbox checked={remember} onChange={setRemember} help={t('connect.rememberHelp')}>
        {t('connect.remember')}
      </Checkbox>
      {check.error && <SubmitError error={check.error} baseUrl={check.variables?.baseUrl ?? ''} />}
      <div className="connect-actions">
        <Button type="submit" variant="primary" loading={check.isPending}>
          {t('connect.submit')}
        </Button>
        {target && (
          <Button variant="ghost" onClick={onOther}>
            {t('connect.other')}
          </Button>
        )}
      </div>
    </form>
  );
}

function SavedList({ onUse }: { onUse: () => void }) {
  const { list, active, setActive, remove } = useConnections();
  const navigate = useNavigate();
  const [removing, setRemoving] = useState<SavedConnection>();
  const headingId = useId();

  return (
    <section className="connect-saved" aria-labelledby={headingId}>
      <h2 id={headingId}>{t('connect.saved')}</h2>
      <ul className="connect-saved__list" aria-labelledby={headingId}>
        {list.map((c) => (
          <li key={c.id} className="connect-saved__item">
            <div className="connect-saved__main">
              <div className="connect-saved__title">
                <span className="connect-saved__name">{c.name}</span>
                {c.id === active?.id && <Badge tone="accent">{t('connect.active')}</Badge>}
                {needsKey(c) ? (
                  <Badge tone="warn">{t('connect.keyNeeded')}</Badge>
                ) : (
                  c.sessionOnly && <Badge tone="neutral">{t('connect.thisTab')}</Badge>
                )}
              </div>
              <span className="connect-saved__url mono">{c.baseUrl}</span>
            </div>
            <div className="connect-saved__actions">
              <Button
                size="sm"
                aria-label={t('connect.useNamed', { name: c.name })}
                onClick={() => {
                  setActive(c.id);
                  onUse();
                  // Without its key, this page asks for it next.
                  if (!needsKey(c)) void navigate('/routes');
                }}
              >
                {t('connect.use')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<Trash2 size={13} />}
                aria-label={t('connect.removeNamed', { name: c.name })}
                onClick={() => setRemoving(c)}
              >
                {t('connect.remove')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={removing !== undefined}
        title={t('connect.removeTitle', { name: removing?.name ?? '' })}
        body={t('connect.removeBody')}
        confirmLabel={t('connect.remove')}
        danger
        onConfirm={() => {
          if (removing) remove(removing.id);
          setRemoving(undefined);
        }}
        onCancel={() => setRemoving(undefined)}
      />
    </section>
  );
}

/** Server-managed mode without a key to ask for: the server's own key is wrong, and only its operator can fix it. */
function ServerKeyRejected({ reason }: { reason: string }) {
  const navigate = useNavigate();
  return (
    <div className="connect">
      <div className="connect-column">
        <div className="connect-top">
          <Brand />
        </div>
        <h1 tabIndex={-1}>{t('connect.serverKeyRejected.title')}</h1>
        <p className="connect-intro">{t('connect.serverKeyRejected.body')}</p>
        <p className="connect-alert__detail connect-reason mono">{reason}</p>
        <div className="connect-actions">
          <Button variant="primary" onClick={() => void navigate('/routes', { replace: true })}>
            {t('connect.retry')}
          </Button>
        </div>
      </div>
    </div>
  );
}
