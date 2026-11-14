import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../i18n';
import { AppErrorBoundary, ErrorPage } from './ErrorPage';

afterEach(() => {
  // replaceState fires no hashchange, which would otherwise reach the next test late.
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

describe('ErrorPage', () => {
  it('shows the message with Reload and Back to connections', () => {
    render(<ErrorPage error={new Error('something specific')} />);
    expect(screen.getByRole('heading', { level: 1, name: t('error.title') })).toBeInTheDocument();
    expect(screen.getByText('something specific')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('error.reload') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('error.backToConnections') })).toBeInTheDocument();
  });

  it('copes with errors that are not Error objects', () => {
    render(<ErrorPage error="plain string" />);
    expect(screen.getByText('plain string')).toBeInTheDocument();
  });
});

describe('AppErrorBoundary', () => {
  it('replaces a crashed tree with the error page, and recovers on Back to connections', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    let broken = true;
    function MaybeBoom() {
      if (broken) throw new Error('render exploded');
      return <p>fine again</p>;
    }
    render(
      <AppErrorBoundary>
        <MaybeBoom />
      </AppErrorBoundary>,
    );
    expect(screen.getByRole('heading', { level: 1, name: t('error.title') })).toBeInTheDocument();
    expect(screen.getByText('render exploded')).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalled();

    broken = false;
    await user.click(screen.getByRole('button', { name: t('error.backToConnections') }));
    expect(window.location.hash).toBe('#/connect');
    expect(await screen.findByText('fine again')).toBeInTheDocument();
  });
});
