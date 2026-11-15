import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { LockProvider } from './LockContext';
import { Segmented } from './Segmented';
import { TooltipProvider } from './Tooltip';

const OPTIONS = [
  { value: 'nodes', label: 'Nodes' },
  { value: 'discovery', label: 'Service discovery' },
  { value: 'off', label: 'Off', disabled: true, reason: 'Nothing to turn off yet' },
];

function Harness({ locked = false }: { locked?: boolean }) {
  const [value, setValue] = useState('nodes');
  return (
    <LockProvider locked={locked}>
      <Segmented label="Send requests to" options={OPTIONS} value={value} onChange={setValue} help="Pick one" />
      <output>{value}</output>
    </LockProvider>
  );
}

describe('Segmented', () => {
  it('is a radio group: click or arrow keys choose, Tab stops on the chosen one only', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const group = screen.getByRole('radiogroup', { name: 'Send requests to' });
    expect(group).toHaveAccessibleDescription('Pick one');
    const nodes = screen.getByRole('radio', { name: 'Nodes' });
    const discovery = screen.getByRole('radio', { name: 'Service discovery' });
    expect(nodes).toBeChecked();
    expect(nodes).toHaveAttribute('tabindex', '0');
    expect(discovery).toHaveAttribute('tabindex', '-1');

    await user.click(discovery);
    expect(screen.getByRole('status')).toHaveTextContent('discovery');
    expect(discovery).toBeChecked();

    // Arrows skip a disabled option and wrap around.
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('status')).toHaveTextContent('nodes');
    expect(nodes).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('status')).toHaveTextContent('discovery');
    expect(screen.getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('a disabled option stays readable, chooses nothing on a click, and says why in a tooltip (known item 17)', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <Harness />
      </TooltipProvider>,
    );
    const off = screen.getByRole('radio', { name: 'Off' });
    expect(off).toHaveAttribute('aria-disabled', 'true');
    expect(off).not.toHaveAttribute('disabled');
    await user.hover(off);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Nothing to turn off yet');
    await user.click(off);
    expect(screen.getByRole('status')).toHaveTextContent('nodes');
    expect(off).not.toBeChecked();
  });

  it('the reason is the disabled option\'s accessible description, the tooltip closed (fix round 1, R6.7)', () => {
    render(
      <TooltipProvider>
        <Harness />
      </TooltipProvider>,
    );
    expect(screen.getByRole('radio', { name: 'Off' })).toHaveAccessibleDescription('Nothing to turn off yet');
    expect(screen.getByRole('radio', { name: 'Nodes' })).not.toHaveAccessibleDescription();
  });

  it('without a TooltipProvider the reason is the native title', () => {
    render(<Harness />);
    expect(screen.getByRole('radio', { name: 'Off' })).toHaveAttribute('title', 'Nothing to turn off yet');
  });

  it('reads as the chosen label when locked', () => {
    render(<Harness locked />);
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.getByText('Nodes')).toBeInTheDocument();
    expect(screen.getByText('Send requests to')).toBeInTheDocument();
  });
});
