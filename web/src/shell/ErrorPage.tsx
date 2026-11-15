import { CircleAlert } from 'lucide-react';
import { Component, type ReactNode } from 'react';
import { isRouteErrorResponse, useRouteError } from 'react-router';
import { t } from '../i18n';
import { Button } from '../ui';

function messageOf(error: unknown): string {
  if (isRouteErrorResponse(error)) return `${error.status} ${error.statusText}`.trim();
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * What replaces a page that crashed: the error, Reload, and a way back to the Connect page; with
 * `onRetry`, Try again first, which renders the page again without leaving it.
 */
export function ErrorPage({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="shell-error" role="alert">
      <CircleAlert className="shell-error__icon" aria-hidden="true" size={22} strokeWidth={2.25} />
      <h1>{t('error.title')}</h1>
      <p className="shell-error__body">{t('error.body')}</p>
      <pre className="shell-error__message">{messageOf(error)}</pre>
      <div className="shell-error__actions">
        {onRetry && (
          <Button variant="primary" onClick={onRetry}>
            {t('error.retry')}
          </Button>
        )}
        <Button variant={onRetry ? 'secondary' : 'primary'} onClick={() => window.location.reload()}>
          {t('error.reload')}
        </Button>
        <Button onClick={() => (window.location.hash = '#/connect')}>{t('error.backToConnections')}</Button>
      </div>
    </div>
  );
}

/** The router's errorElement: a render or loader error below a route. */
export function RouteErrorPage() {
  return <ErrorPage error={useRouteError()} />;
}

/** Catches what the router can't (the providers around it). Try again, or going to another page, clears the error. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { error?: { value: unknown } }> {
  state: { error?: { value: unknown } } = {};

  static getDerivedStateFromError(error: unknown) {
    return { error: { value: error } };
  }

  componentDidMount() {
    window.addEventListener('hashchange', this.reset);
  }

  componentWillUnmount() {
    window.removeEventListener('hashchange', this.reset);
  }

  reset = () => {
    if (this.state.error) this.setState({ error: undefined });
  };

  render() {
    return this.state.error ? <ErrorPage error={this.state.error.value} onRetry={this.reset} /> : this.props.children;
  }
}
