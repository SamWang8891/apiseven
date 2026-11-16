import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BusySwitch } from './index';

function Harness({ busy }: { busy: boolean }) {
  return (
    <>
      <p id="what">Turns the route on or off</p>
      <BusySwitch checked busy={busy} busyText="Saving…" aria-label="Status" aria-describedby="what" title="Status of the route" onCheckedChange={vi.fn()} />
    </>
  );
}

describe('BusySwitch', () => {
  it('keeps a caller’s description and title when idle; while busy it adds "saving" to the description and shows it as the tooltip', () => {
    const { rerender } = render(<Harness busy={false} />);
    const idle = screen.getByRole('switch', { name: 'Status' });
    expect(idle).toHaveAccessibleDescription('Turns the route on or off');
    expect(idle).toHaveAttribute('title', 'Status of the route');
    rerender(<Harness busy />);
    const busy = screen.getByRole('switch', { name: 'Status' });
    expect(busy).toHaveAccessibleDescription('Turns the route on or off Saving…');
    expect(busy).toHaveAttribute('title', 'Saving…');
    rerender(<Harness busy={false} />);
    expect(screen.getByRole('switch', { name: 'Status' })).toHaveAccessibleDescription('Turns the route on or off');
    expect(screen.getByRole('switch', { name: 'Status' })).toHaveAttribute('title', 'Status of the route');
  });
});

describe('BusySwitch, unavailable through its own aria-disabled (rebase check M2)', () => {
  it('keeps the attribute, stays focusable, and drops a change; it is not busy', async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(
      <>
        <p id="why">This admin key is read-only</p>
        <BusySwitch checked busy={false} busyText="Saving…" aria-label="Status" aria-disabled aria-describedby="why" onCheckedChange={changed} />
      </>,
    );
    const sw = screen.getByRole('switch', { name: 'Status' });
    expect(sw).toHaveAttribute('aria-disabled', 'true');
    expect(sw).not.toHaveAttribute('aria-busy');
    expect(sw).not.toBeDisabled();
    expect(sw).toHaveAccessibleDescription('This admin key is read-only');
    sw.focus();
    await user.keyboard(' ');
    await user.click(sw);
    expect(changed).not.toHaveBeenCalled();
    expect(sw).toBeChecked();
    expect(sw).toHaveFocus();
  });
});
