import { render, screen } from '@testing-library/react';
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
