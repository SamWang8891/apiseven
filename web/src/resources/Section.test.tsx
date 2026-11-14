import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { Section } from './Section';

describe('Section', () => {
  it('toggles its body; collapsed, it describes itself with its summary', async () => {
    const user = userEvent.setup();
    render(
      <Section title="Connection" summary="https, 1 retry">
        <p>body</p>
      </Section>,
    );
    const button = screen.getByRole('button', { name: 'Connection' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAccessibleDescription('https, 1 retry');
    expect(screen.queryByText('body')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Connection' })).toBeInTheDocument();

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('body')).toBeInTheDocument();
    expect(screen.queryByText('https, 1 retry')).not.toBeInTheDocument();
  });

  it('starts open when told, and opens when an issue appears inside', () => {
    const { rerender } = render(
      <Section title="TLS" issues={0}>
        <p>body</p>
      </Section>,
    );
    expect(screen.queryByText('body')).not.toBeInTheDocument();
    rerender(
      <Section title="TLS" issues={2}>
        <p>body</p>
      </Section>,
    );
    expect(screen.getByText('body')).toBeInTheDocument();
    expect(screen.getByText(t('ui.tabs.errors', { count: 2 }))).toBeInTheDocument();

    render(
      <Section title="Nodes" defaultOpen>
        <p>nodes body</p>
      </Section>,
    );
    expect(screen.getByText('nodes body')).toBeInTheDocument();
  });
});
