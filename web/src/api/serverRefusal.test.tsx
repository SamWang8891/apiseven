// Answers apiseven's own server makes (Docker mode), marked X-Apiseven-Refusal: never APISIX's, so
// never a key problem. They get their own error kind ('server'), or 'network' when the server could
// not reach APISIX ('upstream'), and every place that shows an error names them as what they are.
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { saveFailure } from '../editor/failure';
import { LoadErrorState } from '../editor/states';
import { t } from '../i18n';
import { ErrorState } from '../table/states';
import { renderApp, resetApp } from '../test/app';
import { fakeAdmin, json } from '../test/fakeAdmin';
import { getToasts } from '../ui/toast';
import { AdminClient } from './client';
import { ApiError } from './errors';
import { ClientProvider } from './hooks';
import { createQueryClient } from './queryClient';
import { unreachableError } from './reachability';
import { resetReadOnlyKeys, useReadOnlyKey, useWrite } from './write';

afterEach(() => {
  resetReadOnlyKeys();
  resetApp();
});

const ORIGIN_MSG = 'apiseven: refused a request from another origin (Origin https://a.example, Host apiseven:8080). A reverse proxy in front of apiseven must pass the Host header through unchanged.';
const UPSTREAM_MSG = 'apiseven: cannot reach the APISIX Admin API at apisix:9180: dial tcp: lookup apisix: no such host';

/** An answer as apiseven's server writes its own refusals. */
function refusal(status: number, reason: string, errorMsg: string): Response {
  return new Response(JSON.stringify({ error_msg: errorMsg }), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Apiseven-Refusal': reason, ...(reason === 'auth' && { 'WWW-Authenticate': 'Basic realm="apiseven"' }) },
  });
}

/** A client whose every request gets `answer`; baseUrl '' is apiseven's server (the page's origin). */
function clientAnswering(answer: () => Response, baseUrl = '') {
  return new AdminClient({ id: 'c', name: 'c', baseUrl }, () => Promise.resolve(answer()));
}

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(err instanceof ApiError)) throw new Error(`expected an ApiError, got ${String(err)}`);
  return err;
}

describe('AdminClient', () => {
  it("a refusal by apiseven's server is kind server, with its reason and sentence, never APISIX's message", async () => {
    const err = await failure(clientAnswering(() => refusal(403, 'origin', ORIGIN_MSG)).list('routes'));
    expect(err.kind).toBe('server');
    expect(err.status).toBe(403);
    expect(err.refusal).toEqual({ reason: 'origin', message: ORIGIN_MSG });
    expect(err.errorMsg).toBeUndefined();
    expect(err.message).toBe(`${t('api.server.refused')}: ${ORIGIN_MSG}`);
  });

  it('its Basic auth refusal says to sign in again', async () => {
    const err = await failure(clientAnswering(() => refusal(401, 'auth', 'apiseven: sign-in required')).list('routes'));
    expect(err.kind).toBe('server');
    expect(err.message).toBe(`${t('api.server.signIn')}: apiseven: sign-in required`);
  });

  it('"cannot reach APISIX" is kind network, carrying the server\'s sentence (the address it tried)', async () => {
    const err = await failure(clientAnswering(() => refusal(502, 'upstream', UPSTREAM_MSG)).list('routes'));
    expect(err.kind).toBe('network');
    expect(err.refusal).toEqual({ reason: 'upstream', message: UPSTREAM_MSG });
    expect(err.message).toBe(`${t('api.server.upstream')}: ${UPSTREAM_MSG}`);
  });

  it('"cannot reach APISIX" marks the Admin API unreachable; a refusal says nothing about APISIX either way', async () => {
    const down = new AdminClient({ id: 'down', name: 'down', baseUrl: '' }, () => Promise.resolve(refusal(502, 'upstream', UPSTREAM_MSG)));
    const err = await failure(down.list('routes'));
    expect(unreachableError('down')).toBe(err);
    // A refusal after it is apiseven's answer, not APISIX's: the connection stays unreachable.
    const refused = new AdminClient({ id: 'down', name: 'down', baseUrl: '' }, () => Promise.resolve(refusal(403, 'origin', ORIGIN_MSG)));
    await failure(refused.list('routes'));
    expect(unreachableError('down')).toBe(err);
    // APISIX's own answer through the proxy proves it reachable.
    await new AdminClient({ id: 'down', name: 'down', baseUrl: '' }, () => Promise.resolve(json(200, { total: 0, list: [] }))).list('routes');
    expect(unreachableError('down')).toBeUndefined();
  });

  it("the marker counts only from the page's own origin: APISIX itself cannot be apiseven's server", async () => {
    const err = await failure(clientAnswering(() => refusal(403, 'origin', ORIGIN_MSG), 'http://apisix.test:9180').list('routes'));
    expect(err.kind).toBe('auth');
  });

  it("APISIX's own 401 through the proxy (no marker) is still a key problem", async () => {
    const err = await failure(clientAnswering(() => json(401, { error_msg: 'failed to check token', description: 'wrong apikey' })).list('routes'));
    expect(err.kind).toBe('auth');
  });

  it('supports() passes a refusal on instead of reading it as "this APISIX lacks the kind"', async () => {
    const err = await failure(clientAnswering(() => refusal(403, 'header', 'apiseven: missing X-Apiseven-Request header')).supports('protos'));
    expect(err.kind).toBe('server');
  });
});

describe('the query policy', () => {
  it('never retries a refusal nor reports it as an auth error; "cannot reach APISIX" is retried like any network failure', async () => {
    let reported = 0;
    const qc = createQueryClient({ onQueryAuthError: () => (reported += 1) });
    const retry = qc.getDefaultOptions().queries?.retry as (n: number, e: unknown) => boolean;
    const refused = new ApiError('server', 'x', { status: 403, refusal: { reason: 'origin', message: ORIGIN_MSG } });
    expect(retry(0, refused)).toBe(false);
    expect(retry(0, new ApiError('network', 'x', { status: 502, refusal: { reason: 'upstream', message: UPSTREAM_MSG } }))).toBe(true);
    await qc.fetchQuery({ queryKey: ['c', 'routes'], queryFn: () => Promise.reject(refused) }).catch(() => {});
    expect(reported).toBe(0);
  });
});

describe('a refused write', () => {
  it('never marks the connection read-only; the toast names who refused, then the server\'s sentence', async () => {
    const admin = fakeAdmin({ replies: { 'routes/r1': () => refusal(403, 'origin', ORIGIN_MSG) } });
    const client = new AdminClient({ id: 'c', name: 'c', baseUrl: '' }, admin.fetch);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <ClientProvider client={client}>{children}</ClientProvider>
      </QueryClientProvider>
    );
    const { result } = renderHook(() => ({ write: useWrite(), readOnly: useReadOnlyKey() }), { wrapper });
    await act(async () => {
      await result.current.write((c) => c.remove('routes', 'r1'));
    });
    expect(result.current.readOnly).toBe(false);
    expect(getToasts().at(-1)).toMatchObject({ tone: 'error', message: `${t('api.server.refused')}: ${ORIGIN_MSG}` });
  });

  it("a refused save's banner says the apiseven server refused it, with the server's sentence below", () => {
    const err = new ApiError('server', 'x', { status: 403, refusal: { reason: 'origin', message: ORIGIN_MSG } });
    expect(saveFailure(err)).toEqual({ title: t('api.server.refused'), message: ORIGIN_MSG });
    const signIn = new ApiError('server', 'x', { status: 401, refusal: { reason: 'auth', message: 'apiseven: sign-in required' } });
    expect(saveFailure(signIn)).toEqual({ title: t('api.server.signIn'), message: 'apiseven: sign-in required' });
  });
});

describe('a save that never reached APISIX, or got no answer', () => {
  it('is titled that way in direct mode, not "APISIX rejected the change"', async () => {
    const client = new AdminClient({ id: 'c', name: 'c', baseUrl: 'http://apisix.test:9180' }, () => Promise.reject(new TypeError('Failed to fetch')));
    const err = await failure(client.replace('routes', 'r1', { uri: '/' }));
    expect(err.kind).toBe('network');
    expect(saveFailure(err)).toEqual({ title: t('editor.unreachable'), message: 'Network error: Failed to fetch' });
  });

  it("is titled from the apiseven server's side when it could not reach APISIX, with its sentence", async () => {
    const err = await failure(clientAnswering(() => refusal(502, 'upstream', UPSTREAM_MSG)).replace('routes', 'r1', { uri: '/' }));
    expect(saveFailure(err)).toEqual({ title: t('api.server.upstream'), message: UPSTREAM_MSG });
  });
});

describe('load errors', () => {
  const refused = new ApiError('server', 'x', { status: 403, refusal: { reason: 'origin', message: ORIGIN_MSG } });
  const client = new AdminClient({ id: 'c', name: 'c', baseUrl: '' }, () => Promise.reject(new Error('unused')));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient()}>
      <ClientProvider client={client}>{children}</ClientProvider>
    </QueryClientProvider>
  );

  it("a list's error state is headed by who refused, with the server's sentence", () => {
    render(<ErrorState plural="routes" error={refused} />, { wrapper });
    expect(screen.getByRole('heading', { name: t('api.server.refused') })).toBeInTheDocument();
    expect(screen.getByText(ORIGIN_MSG)).toBeInTheDocument();
  });

  it("an editor's load error too", () => {
    render(<LoadErrorState kind="routes" id="r1" error={refused} retrying={false} onRetry={() => {}} />, { wrapper });
    expect(screen.getByRole('heading', { name: t('api.server.refused') })).toBeInTheDocument();
    expect(screen.getByText(ORIGIN_MSG)).toBeInTheDocument();
  });
});

describe('the whole app, server-managed', () => {
  it('a refused list read stays on the page (no Connect, no "key rejected") and says the apiseven server refused it', async () => {
    renderApp({
      hash: '#/routes',
      config: { adminBase: 'apisix/admin', keyRequired: false },
      replies: { routes: () => refusal(403, 'origin', ORIGIN_MSG) },
    });
    expect(await screen.findByRole('heading', { name: t('api.server.refused') })).toBeInTheDocument();
    expect(screen.getByText(ORIGIN_MSG)).toBeInTheDocument();
    expect(window.location.hash).toBe('#/routes');
    expect(screen.queryByRole('heading', { name: t('connect.serverKeyRejected.title') })).toBeNull();
  });

  it('a stale sign-in says to sign in again', async () => {
    renderApp({
      hash: '#/routes',
      config: { adminBase: 'apisix/admin', keyRequired: false },
      replies: { routes: () => refusal(401, 'auth', 'apiseven: sign-in required') },
    });
    expect(await screen.findByRole('heading', { name: t('api.server.signIn') })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/routes');
  });

  describe('Connect, when the server wants a key', () => {
    async function submitKey(reply: () => Response) {
      const user = userEvent.setup();
      renderApp({ hash: '#/connect', config: { adminBase: 'apisix/admin', keyRequired: true }, replies: { routes: reply } });
      await screen.findByRole('heading', { level: 1, name: t('connect.title') });
      await user.type(screen.getByLabelText(t('connect.key'), { exact: false }), 'some-key');
      await user.click(screen.getByRole('button', { name: t('connect.submit') }));
      return screen.findByRole('alert');
    }

    it('a refusal is not "the Admin API rejected this key"', async () => {
      const alert = await submitKey(() => refusal(403, 'header', 'apiseven: missing X-Apiseven-Request header'));
      expect(alert).toHaveTextContent(t('api.server.refused'));
      expect(alert).toHaveTextContent('apiseven: missing X-Apiseven-Request header');
      expect(alert).not.toHaveTextContent(t('connect.badKey'));
    });

    it('"cannot reach APISIX" names the server\'s side, not this browser\'s allow_admin', async () => {
      const alert = await submitKey(() => refusal(502, 'upstream', UPSTREAM_MSG));
      await waitFor(() => expect(alert).toHaveTextContent(t('api.server.upstream')));
      expect(alert).toHaveTextContent(UPSTREAM_MSG);
      expect(alert).not.toHaveTextContent(t('connect.networkHint'));
    });
  });
});
