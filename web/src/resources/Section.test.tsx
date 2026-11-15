// A Section's open state in the page's view memory (fix round 1, R4.3): a problem that appeared while
// it was unmounted opens it on return; two sections with one title on different tabs keep their own.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { ViewMemory, ViewScope } from '../ui';
import { Section } from './Section';

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
