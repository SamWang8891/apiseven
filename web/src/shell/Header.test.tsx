import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../i18n';
import { DEV_CONN, renderApp, resetApp, saveConnections } from '../test/app';
import { GENERAL_TAB, overrideDef } from '../test/editor';

const undo: (() => void)[] = [];
afterEach(() => {
  for (const u of undo.splice(0)) u();
  resetApp();
  delete document.documentElement.dataset.theme;
});

const PROD = { id: 'prod', name: 'prod', baseUrl: 'https://prod.test:9180', key: 'prod-key' };

async function banner() {
  return within(await screen.findByRole('banner'));
}

describe('Header', () => {
  it('shows the active connection, its host, and the APISIX version', async () => {
    saveConnections([DEV_CONN, PROD], DEV_CONN.id);
    renderApp({ hash: '#/routes' });
    const header = await banner();
    const switcher = header.getByRole('button', { name: t('header.connection', { name: 'dev', host: 'apisix.test:9180' }) });
    expect(switcher).toBeInTheDocument();
    expect(await header.findByText('APISIX 3.20.0')).toHaveClass('mono');
  });

  it('the connection button shows the words of its name: the connection, a space, the host (label in name)', async () => {
    saveConnections([DEV_CONN, PROD], DEV_CONN.id);
    renderApp({ hash: '#/routes' });
    const header = await banner();
    const switcher = header.getByRole('button', { name: t('header.connection', { name: 'dev', host: 'apisix.test:9180' }) });
    expect(switcher.textContent).toBe('dev apisix.test:9180');
  });

  it('switches to another saved connection', async () => {
    saveConnections([DEV_CONN, PROD], DEV_CONN.id);
    const user = userEvent.setup();
    const { admin } = renderApp({ hash: '#/routes' });
    const header = await banner();
    await user.click(header.getByRole('button', { name: /^Connection: dev/ }));
    await user.click(await screen.findByRole('menuitem', { name: /prod/ }));
    await waitFor(() => expect(header.getByRole('button', { name: /^Connection: prod/ })).toBeInTheDocument());
    await waitFor(() => expect(admin.requests.some((r) => r.url.origin === 'https://prod.test:9180')).toBe(true));
    expect(window.location.hash).toBe('#/routes');
  });

  it('switching from an editor with unsaved changes asks first, as the palette does: Stay keeps the connection and the draft (Task 16b, item 135)', async () => {
    undo.push(overrideDef('routes', { tabs: [GENERAL_TAB] }));
    saveConnections([DEV_CONN, PROD], DEV_CONN.id);
    const user = userEvent.setup();
    renderApp({ hash: '#/routes/r1', counts: {}, objects: { routes: [{ id: 'r1', name: 'shop', uri: '/cart/*' }] } });
    const main = within(await screen.findByRole('main'));
    await main.findByRole('heading', { level: 1, name: 'shop' });
    await user.keyboard('e');
    await user.type(await main.findByRole('textbox', { name: 'URI' }), 'more');
    // The shell's header (the editor has a header of its own).
    const header = within(document.querySelector('.shell-header') as HTMLElement);
    await user.click(header.getByRole('button', { name: /^Connection: dev/ }));
    await user.click(await screen.findByRole('menuitem', { name: /prod/ }));
    const leave = await screen.findByRole('alertdialog', { name: t('editor.leave.title') });
    await user.click(within(leave).getByRole('button', { name: t('ui.cancel') }));
    expect(header.getByRole('button', { name: /^Connection: dev/ })).toBeInTheDocument();
    expect(main.getByRole('textbox', { name: 'URI' })).toHaveValue('/cart/*more');
    expect(window.location.hash).toBe('#/routes/r1');

    await user.click(header.getByRole('button', { name: /^Connection: dev/ }));
    await user.click(await screen.findByRole('menuitem', { name: /prod/ }));
    await user.click(within(await screen.findByRole('alertdialog', { name: t('editor.leave.title') })).getByRole('button', { name: t('editor.leave.confirm') }));
    await waitFor(() => expect(header.getByRole('button', { name: /^Connection: prod/ })).toBeInTheDocument());
    expect(window.location.hash).toBe('#/routes');
  });

  it('"Add connection…" opens a blank Connect form', async () => {
    saveConnections([DEV_CONN], DEV_CONN.id);
    const user = userEvent.setup();
    renderApp({ hash: '#/routes' });
    const header = await banner();
    await user.click(header.getByRole('button', { name: /^Connection: dev/ }));
    await user.click(await screen.findByRole('menuitem', { name: t('header.addConnection') }));
    await waitFor(() => expect(window.location.hash).toBe('#/connect'));
    expect(await screen.findByLabelText(t('connect.url'))).toHaveValue('');
  });

  it('"Disconnect" goes to Connect and keeps the saved connection', async () => {
    saveConnections([DEV_CONN], DEV_CONN.id);
    const user = userEvent.setup();
    renderApp({ hash: '#/routes' });
    const header = await banner();
    await user.click(header.getByRole('button', { name: /^Connection: dev/ }));
    await user.click(await screen.findByRole('menuitem', { name: t('header.disconnect') }));
    await waitFor(() => expect(window.location.hash).toBe('#/connect'));
    expect(await screen.findByRole('list', { name: t('connect.saved') })).toHaveTextContent('dev');
  });

  it('picking a connection whose key is not in this tab asks for the key', async () => {
    saveConnections([DEV_CONN, { id: 'tab', name: 'staging', baseUrl: 'http://staging.test:9180', sessionOnly: true }], DEV_CONN.id);
    const user = userEvent.setup();
    renderApp({ hash: '#/routes' });
    const header = await banner();
    await user.click(header.getByRole('button', { name: /^Connection: dev/ }));
    await user.click(await screen.findByRole('menuitem', { name: /staging/ }));
    await waitFor(() => expect(window.location.hash).toBe('#/connect'));
    expect(await screen.findByText('http://staging.test:9180')).toBeInTheDocument();
    expect(screen.getByLabelText(t('connect.key'), { exact: false })).toBeInTheDocument();
    expect(screen.queryByLabelText(t('connect.url'))).toBeNull();
  });

  it('switches the theme', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    saveConnections([DEV_CONN], DEV_CONN.id);
    const user = userEvent.setup();
    renderApp({ hash: '#/routes' });
    const header = await banner();
    const group = header.getByRole('group', { name: t('theme.label') });
    expect(within(group).getByRole('button', { name: t('theme.system') })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(group).getByRole('button', { name: t('theme.dark') }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(within(group).getByRole('button', { name: t('theme.dark') })).toHaveAttribute('aria-pressed', 'true');
  });

  it('is a plain label in server-managed mode', async () => {
    renderApp({ config: { adminBase: '/apisix/admin', keyRequired: false } });
    const header = await banner();
    expect(header.getByText(location.host)).toBeInTheDocument();
    expect(header.queryByRole('button', { name: /^Connection:/ })).toBeNull();
  });
});
