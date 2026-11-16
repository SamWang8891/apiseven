import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { Menu } from './Menu';
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

// Task 18, fix round 3: a loading Button keeps keyboard focus through its action and after; every
// activation is ignored meanwhile (click, Enter, Space, a form's implicit submission).
describe('Button, loading', () => {
  it('is busy and aria-disabled, not disabled: a click, Enter and Space all do nothing', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    // Not disabled: a focused control that becomes disabled loses focus in a browser (jsdom does not show that).
    expect(button).not.toBeDisabled();
    await user.click(button);
    button.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onClick).not.toHaveBeenCalled();
    expect(button).toHaveFocus();
  });

  it('a form’s submit button that is loading: neither a click nor Enter in a field submits the form again', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <input aria-label="Key" />
        <Button type="submit" loading>
          Connect
        </Button>
      </form>,
    );
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    await user.type(screen.getByRole('textbox', { name: 'Key' }), 'k{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('pressed from the keyboard, it keeps focus while it works and after; then it takes a press again', async () => {
    const user = userEvent.setup();
    let finish: () => void = () => {};
    const work = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    function Harness() {
      const [busy, setBusy] = useState(false);
      return (
        <Button
          loading={busy}
          onClick={() => {
            setBusy(true);
            void work().finally(() => setBusy(false));
          }}
        >
          Save
        </Button>
      );
    }
    render(<Harness />);
    const button = screen.getByRole('button', { name: 'Save' });
    button.focus();
    await user.keyboard('{Enter}');
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled();
    expect(button).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(work).toHaveBeenCalledTimes(1);
    finish();
    await vi.waitFor(() => expect(button).not.toHaveAttribute('aria-busy'));
    expect(button).not.toHaveAttribute('aria-disabled');
    expect(button).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('keeps its accessible name and description while loading', () => {
    const { rerender } = render(
      <>
        <p id="why">Sends the draft to APISIX</p>
        <Button aria-describedby="why">Save</Button>
      </>,
    );
    const idle = screen.getByRole('button');
    expect(idle).toHaveAccessibleName('Save');
    expect(idle).toHaveAccessibleDescription('Sends the draft to APISIX');
    rerender(
      <>
        <p id="why">Sends the draft to APISIX</p>
        <Button aria-describedby="why" loading>
          Save
        </Button>
      </>,
    );
    const busy = screen.getByRole('button');
    expect(busy).toHaveAccessibleName('Save');
    expect(busy).toHaveAccessibleDescription('Sends the draft to APISIX');
  });

  it('an icon-only button keeps its label as its name while loading', () => {
    render(<Button aria-label="Refresh" loading icon={<span />} />);
    expect(screen.getByRole('button', { name: 'Refresh' })).toHaveAttribute('aria-busy', 'true');
  });
});

describe('Button, disabled', () => {
  it('disabled for another reason stays disabled, loading or not; it is aria-disabled only while loading (busy is always marked so)', () => {
    const { rerender } = render(<Button disabled>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save' })).not.toHaveAttribute('aria-disabled');
    rerender(
      <Button disabled loading>
        Save
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('aria-disabled', 'true');
  });
});

// Final wave I2: a loading or unavailable Button blocks every activation, the ones a trigger listens
// to included: a menu trigger opens on Enter, Space or ArrowDown, and on a pointer press, not on click.
describe('a busy or unavailable Button used as a menu trigger', () => {
  function Harness({ loading, unavailable }: { loading?: boolean; unavailable?: boolean }) {
    return <Menu trigger={<Button aria-label="More" icon={icon} loading={loading} aria-disabled={unavailable || undefined} />} items={[{ id: 'a', label: 'Do it', onSelect: () => {} }]} />;
  }

  it('loading: neither Enter, Space, ArrowDown nor a pointer press opens its menu; it keeps focus', async () => {
    const user = userEvent.setup();
    render(<Harness loading />);
    const trigger = screen.getByRole('button', { name: 'More' });
    trigger.focus();
    for (const key of ['{Enter}', ' ', '{ArrowDown}']) {
      await user.keyboard(key);
      expect(screen.queryByRole('menu')).toBeNull();
    }
    await user.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('unavailable through its own aria-disabled (not loading): the same, and the attribute is kept', async () => {
    const user = userEvent.setup();
    render(<Harness unavailable />);
    const trigger = screen.getByRole('button', { name: 'More' });
    expect(trigger).toHaveAttribute('aria-disabled', 'true');
    trigger.focus();
    for (const key of ['{Enter}', ' ', '{ArrowDown}']) {
      await user.keyboard(key);
      expect(screen.queryByRole('menu')).toBeNull();
    }
    await user.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('neither loading nor unavailable: Enter opens it, as before', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    screen.getByRole('button', { name: 'More' }).focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('menu')).toBeInTheDocument();
  });
});
