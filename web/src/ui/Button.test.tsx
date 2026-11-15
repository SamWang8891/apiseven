import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Pencil } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { Button } from './Button';
import { TooltipProvider } from './Tooltip';

// Known item 14 and fix round 1 (R6.6): an icon-only Button shows its label as a tooltip on hover and
// on keyboard focus; never on focus that follows a click; its native title without a provider.

const icon = <Pencil size={14} />;

describe('icon-only Button', () => {
  it('its tooltip says its label, on hover', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <Button icon={icon} aria-label="Edit route" />
      </TooltipProvider>,
    );
    const button = screen.getByRole('button', { name: 'Edit route' });
    expect(button).not.toHaveAttribute('title');
    await user.hover(button);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Edit route');
  });

  // Task 16b item 158: tooltips are click-through, so nothing is meant to be hovered into; one that waited for
  // the pointer to reach it stayed up over the neighbouring control with the wrong label.
  it('its tooltip closes as soon as the pointer leaves the control', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <Button icon={icon} aria-label="Actions for api-v2" />
        <Button icon={icon} aria-label="Actions for api-v1" />
      </TooltipProvider>,
    );
    const two = screen.getByRole('button', { name: 'Actions for api-v2' });
    await user.hover(two);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Actions for api-v2');
    fireEvent.pointerLeave(two, { pointerType: 'mouse' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    await user.hover(screen.getByRole('button', { name: 'Actions for api-v1' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Actions for api-v1');
  });

  it('a title, when given, is what the tooltip says (and not also a native title)', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <Button icon={icon} aria-label="Compact rows" title="Compact rows (on)" />
      </TooltipProvider>,
    );
    const button = screen.getByRole('button', { name: 'Compact rows' });
    expect(button).not.toHaveAttribute('title');
    await user.hover(button);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Compact rows (on)');
  });

  it('without a TooltipProvider, its label is the native title', () => {
    render(<Button icon={icon} aria-label="Edit route" />);
    expect(screen.getByRole('button', { name: 'Edit route' })).toHaveAttribute('title', 'Edit route');
  });

  it('a button with text has no tooltip', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <Button icon={icon}>Edit</Button>
      </TooltipProvider>,
    );
    await user.hover(screen.getByRole('button', { name: 'Edit' }));
    await act(() => new Promise((r) => setTimeout(r, 500)));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('opens on focus after a key press, not on focus after a pointer press', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <button type="button">before</button>
        <Button icon={icon} aria-label="More actions" />
      </TooltipProvider>,
    );
    const button = screen.getByRole('button', { name: 'More actions' });
    // A pointer press somewhere, then focus put on the button by a script (a menu closing, a dialog opening).
    fireEvent.pointerDown(document.body);
    act(() => button.focus());
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    act(() => button.blur());
    // The keyboard: Tab onto it.
    screen.getByRole('button', { name: 'before' }).focus();
    await user.tab();
    expect(button).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('More actions');
  });
});

// Final wave C1 / G3 (and the rule from the last reviews): a button that is busy or unavailable stays
// focusable, as Chromium moves focus off a `disabled` one to body; a press does nothing.
describe('a busy or unavailable Button', () => {
  it('busy: aria-disabled and aria-busy, not disabled; a click or Enter does nothing, and a submit button submits nothing', async () => {
    const user = userEvent.setup();
    let clicks = 0;
    let submits = 0;
    render(
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submits += 1;
        }}
      >
        <input aria-label="name" />
        <Button type="submit" loading onClick={() => (clicks += 1)}>
          Connect
        </Button>
      </form>,
    );
    const button = screen.getByRole('button', { name: 'Connect' });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAttribute('aria-busy', 'true');
    await user.click(button);
    expect(button).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('textbox', { name: 'name' }));
    await user.keyboard('{Enter}');
    expect(clicks).toBe(0);
    expect(submits).toBe(0);
  });

  it('unavailable (aria-disabled): looks disabled, keeps focus, and a press does nothing', async () => {
    const user = userEvent.setup();
    let clicks = 0;
    render(
      <Button aria-disabled onClick={() => (clicks += 1)}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    await user.click(button);
    await user.keyboard('{Enter}{ }');
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(clicks).toBe(0);
  });
});
