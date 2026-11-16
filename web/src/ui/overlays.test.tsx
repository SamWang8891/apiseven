import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { t } from '../i18n';
import { Button, ConfirmDialog, Dialog, Input, LockProvider, Menu, Tabs, type TabsProps } from './index';

describe('ConfirmDialog', () => {
  function setup(busy = false) {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <ConfirmDialog
        open
        title="Delete route game-api?"
        body="Requests to /v1/* will stop matching."
        confirmLabel="Delete route"
        danger
        busy={busy}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    return { onConfirm, onCancel, user };
  }

  it('names the action and calls onConfirm', async () => {
    const { onConfirm, onCancel, user } = setup();
    const dialog = screen.getByRole('alertdialog', { name: 'Delete route game-api?' });
    expect(dialog).toHaveAccessibleDescription('Requests to /v1/* will stop matching.');
    await user.click(within(dialog).getByRole('button', { name: 'Delete route' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('calls onCancel from the cancel button and from Escape', async () => {
    const { onConfirm, onCancel, user } = setup();
    await user.click(screen.getByRole('button', { name: t('ui.cancel') }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('while busy, blocks a second confirm', async () => {
    const { onConfirm, user } = setup(true);
    const confirm = screen.getByRole('button', { name: 'Delete route' });
    expect(confirm).toHaveAttribute('aria-busy', 'true');
    await user.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  // Task 16b item 140: a ConfirmDialog has no trigger of its own; focus goes back to what had it when it opened.
  function Opener({ removeOpener = false }: { removeOpener?: boolean }) {
    const [open, setOpen] = useState(false);
    const [gone, setGone] = useState(false);
    return (
      <main tabIndex={-1} aria-label="page">
        <input aria-label="before" />
        {!gone && <button onClick={() => setOpen(true)}>Delete…</button>}
        <ConfirmDialog
          open={open}
          title="Delete it?"
          confirmLabel="Delete"
          onConfirm={() => {
            if (removeOpener) setGone(true);
            setOpen(false);
          }}
          onCancel={() => setOpen(false)}
        />
      </main>
    );
  }

  it('returns focus to the element that opened it, on Cancel, Escape and a confirm that keeps the page', async () => {
    const user = userEvent.setup();
    render(<Opener />);
    const opener = screen.getByRole('button', { name: 'Delete…' });
    await user.click(opener);
    await user.click(await screen.findByRole('button', { name: t('ui.cancel') }));
    expect(opener).toHaveFocus();
    await user.click(opener);
    await screen.findByRole('alertdialog');
    await user.keyboard('{Escape}');
    expect(opener).toHaveFocus();
    await user.click(opener);
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(opener).toHaveFocus();
  });

  it('when that element is gone, focus goes to main, not body', async () => {
    const user = userEvent.setup();
    render(<Opener removeOpener />);
    await user.click(screen.getByRole('button', { name: 'Delete…' }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('main', { name: 'page' })).toHaveFocus();
  });
});

// Final wave O3: an ordinary dialog has no trigger of its own either; closing it puts focus back as
// ConfirmDialog does: on what opened it, on a menu's trigger for a menu item, never on body.
describe('Dialog', () => {
  function Page({ removeOpener = false }: { removeOpener?: boolean }) {
    const [open, setOpen] = useState(false);
    const [gone, setGone] = useState(false);
    const close = () => {
      if (removeOpener) setGone(true);
      setOpen(false);
    };
    return (
      <main tabIndex={-1} aria-label="page">
        {!gone && <Button onClick={() => setOpen(true)}>View JSON</Button>}
        <Menu trigger={<Button aria-label="More actions" />} items={[{ id: 'json', label: 'View JSON…', onSelect: () => setOpen(true) }]} />
        {open && (
          <Dialog open title="Route as JSON" onClose={close}>
            <p>{'{}'}</p>
          </Dialog>
        )}
      </main>
    );
  }

  it('closing it by Escape or Close puts focus back on the button that opened it', async () => {
    const user = userEvent.setup();
    render(<Page />);
    const opener = screen.getByRole('button', { name: 'View JSON' });
    await user.click(opener);
    await screen.findByRole('dialog', { name: 'Route as JSON' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(opener).toHaveFocus());
    await user.click(opener);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: t('ui.close') }));
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("opened from a menu item, closing it puts focus on the menu's trigger", async () => {
    const user = userEvent.setup();
    render(<Page />);
    const trigger = screen.getByRole('button', { name: 'More actions' });
    await user.click(trigger);
    await user.click(await screen.findByRole('menuitem', { name: 'View JSON…' }));
    await screen.findByRole('dialog', { name: 'Route as JSON' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(document.activeElement).not.toBe(document.body);
  });

  it('when its opener is gone, focus goes to main, not body', async () => {
    const user = userEvent.setup();
    render(<Page removeOpener />);
    await user.click(screen.getByRole('button', { name: 'View JSON' }));
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByRole('main', { name: 'page' })).toHaveFocus());
  });

  // Fix round 1, F2: a field that takes focus as the dialog mounts (autoFocus) keeps Radix from
  // reporting the opening; the opener is taken from that first focus instead.
  it('with a field that takes focus at mount, closing it still puts focus back on the opener', async () => {
    function Search() {
      const [open, setOpen] = useState(false);
      return (
        <main tabIndex={-1} aria-label="page">
          <Button onClick={() => setOpen(true)}>Add plugin</Button>
          {open && (
            <Dialog open title="Add a plugin" onClose={() => setOpen(false)}>
              <input aria-label="Search plugins" autoFocus />
            </Dialog>
          )}
        </main>
      );
    }
    const user = userEvent.setup();
    render(<Search />);
    const opener = screen.getByRole('button', { name: 'Add plugin' });
    await user.click(opener);
    expect(await screen.findByRole('textbox', { name: 'Search plugins' })).toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(opener).toHaveFocus());
  });
});

describe('Tabs', () => {
  const tabs: TabsProps['tabs'] = [
    { id: 'general', label: 'General', content: 'General panel' },
    { id: 'plugins', label: 'Plugins', badge: 3, content: 'Plugins panel' },
    { id: 'json', label: 'JSON', badge: 0, content: 'JSON panel' },
  ];

  function Harness({ onChange }: { onChange: (id: string) => void }) {
    const [active, setActive] = useState('general');
    return (
      <Tabs
        tabs={tabs}
        active={active}
        onChange={(id) => {
          onChange(id);
          setActive(id);
        }}
      />
    );
  }

  it('renders a count pill only for a badge above zero', () => {
    render(<Harness onChange={() => {}} />);
    const plugins = screen.getByRole('tab', { name: /Plugins/ });
    expect(within(plugins).getByText('3')).toBeInTheDocument();
    expect(plugins).toHaveAccessibleName(`Plugins ${t('ui.tabs.errors', { count: 3 })}`);
    expect(screen.getByRole('tab', { name: 'JSON' }).querySelector('.ui-tabs__badge')).toBeNull();
  });

  it('switches on click', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);
    expect(screen.getByRole('tabpanel')).toHaveTextContent('General panel');
    await user.click(screen.getByRole('tab', { name: /Plugins/ }));
    expect(onChange).toHaveBeenLastCalledWith('plugins');
    expect(screen.getByRole('tab', { name: /Plugins/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Plugins panel');
  });

  it('moves between tabs with the arrow keys', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole('tab', { name: 'General' }));
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('plugins');
    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith('general');
  });
});

describe('Input secret', () => {
  it('masks the value until reveal is clicked', async () => {
    const user = userEvent.setup();
    render(<Input label="Admin key" secret value="s3cr3t" onChange={() => {}} />);
    const input = screen.getByLabelText('Admin key');
    expect(input).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: t('ui.secret.show') }));
    expect(input).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: t('ui.secret.hide') }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('masks the value when locked too, and reveals it on request', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <LockProvider locked>
        <Input label="Admin key" secret value="s3cr3t" onChange={() => {}} />
      </LockProvider>,
    );
    expect(container.querySelector('input')).toBeNull();
    expect(screen.queryByText('s3cr3t')).toBeNull();
    expect(container.textContent).not.toContain('s3cr3t');
    await user.click(screen.getByRole('button', { name: t('ui.secret.show') }));
    expect(screen.getByText('s3cr3t')).toHaveClass('ro-value');
  });
});
