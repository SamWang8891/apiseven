// A Section: toggling, its summary, opening for a problem; and its open state in the page's view
// memory (fix round 1, R4.3): a problem that appeared while it was unmounted opens it on return; two
// sections with one title on different tabs keep their own.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { ViewMemory, ViewScope } from '../ui';
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

function Page({ issues }: { issues: number }) {
  const [tab, setTab] = useState('one');
  return (
    <ViewMemory>
      <button type="button" onClick={() => setTab(tab === 'one' ? 'two' : 'one')}>
        switch
      </button>
      <ViewScope name={tab}>
        <Section key={tab} title="Advanced" issues={tab === 'one' ? issues : 0}>
          <p>{tab} body</p>
        </Section>
      </ViewScope>
    </ViewMemory>
  );
}

const toggle = () => screen.getByRole('button', { name: /^Advanced/ });

describe('Section in the view memory', () => {
  it('a problem that appeared while it was away opens it on return', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Page issues={0} />);
    await user.click(toggle());
    await user.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    await user.click(screen.getByRole('button', { name: 'switch' }));
    rerender(<Page issues={1} />);
    await user.click(screen.getByRole('button', { name: 'switch' }));
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
  });

  it('two sections with one title on two tabs keep their own state', async () => {
    const user = userEvent.setup();
    render(<Page issues={0} />);
    await user.click(toggle());
    expect(screen.getByText('one body')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'switch' }));
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    await user.click(screen.getByRole('button', { name: 'switch' }));
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
  });
});
