import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../i18n';
import { Dialog } from './Dialog';
import { Pencil } from 'lucide-react';
import { Button } from './Button';
import { Menu } from './Menu';
import { TooltipProvider } from './Tooltip';
import { Toaster } from './Toaster';
import { dismissToast, getToasts, MAX_VISIBLE, setToastPage, toast, toastsRaised } from './toast';

// Known item 8 and fix round 1 (F3, R5): identical toasts do not stack; at most three show and older
// ones wait collapsed, never dropped; only a visible toast's time runs; none covers a dialog's
// buttons; only a page-bound refusal ends with its page.

beforeEach(() => {
  for (const item of getToasts()) dismissToast(item.id);
});
afterEach(() => vi.useRealTimers());

/** The toasts on screen, by message, in the order they show (CSS `order`: raised order, whatever the mount order). */
const shown = () =>
  [...document.querySelectorAll<HTMLElement>('.ui-toast:not(.ui-toast--more)')]
    .sort((a, b) => Number(a.style.order) - Number(b.style.order))
    .map((el) => el.querySelector('.ui-toast__message')?.firstChild?.textContent);
const moreRow = () => document.querySelector<HTMLElement>('.ui-toast--more');

function withDialog(open: boolean) {
  return (
    <>
      <Toaster />
      <Dialog open={open} onClose={() => {}} title="Replace certificate" footer={<button type="button">Use this pair</button>}>
        body
      </Dialog>
    </>
  );
}

describe('toasts', () => {
  it('a toast saying the same as one still showing replaces it and counts the repeat', () => {
    render(<Toaster />);
    const before = toastsRaised();
    act(() => {
      toast.error('Fix 1 problem before saving');
      toast.success('Saved');
      toast.error('Fix 1 problem before saving');
      toast.error('Fix 1 problem before saving');
    });
    expect(toastsRaised()).toBe(before + 4);
    expect(getToasts().map((item) => [item.message, item.count])).toEqual([
      ['Saved', 1],
      ['Fix 1 problem before saving', 3],
    ]);
    expect(shown()).toEqual(['Saved', 'Fix 1 problem before saving']);
    const repeated = [...document.querySelectorAll<HTMLElement>('.ui-toast')].find((el) => el.textContent?.includes('Fix 1 problem')) as HTMLElement;
    expect(within(repeated).getByText(t('ui.toast.repeat', { count: 3 }))).toBeInTheDocument();
    // The same words in another tone are another notice.
    act(() => toast.info('Saved'));
    expect(getToasts().filter((item) => item.message === 'Saved')).toHaveLength(2);
  });

  it(`shows the newest ${MAX_VISIBLE}; older ones wait behind "+N more", which shows them (none is dropped)`, () => {
    render(<Toaster />);
    act(() => {
      for (const n of [1, 2, 3, 4, 5]) toast.info(`Notice ${n}`);
    });
    expect(getToasts()).toHaveLength(5);
    expect(shown()).toEqual(['Notice 3', 'Notice 4', 'Notice 5']);
    expect(moreRow()).toHaveTextContent(t('ui.toast.more', { count: 2 }));
    fireEvent.click(within(moreRow() as HTMLElement).getByRole('button', { name: t('ui.toast.showMore', { more: t('ui.toast.moreShort', { count: 2 }) }) }));
    expect(shown()).toEqual(['Notice 1', 'Notice 2', 'Notice 3', 'Notice 4', 'Notice 5']);
    expect(moreRow()).toBeNull();
  });

  it('a waiting toast\'s time does not run: it gets its whole time once it shows', () => {
    vi.useFakeTimers();
    render(<Toaster />);
    act(() => {
      toast.error('APISIX refused: etcd down');
      for (const n of [1, 2, 3]) toast.info(`Notice ${n}`);
    });
    expect(shown()).toEqual(['Notice 1', 'Notice 2', 'Notice 3']);
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    // The infos ran out (5 s); the error was waiting all along.
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(shown()).toEqual(['APISIX refused: etcd down']);
    act(() => {
      vi.advanceTimersByTime(9000);
    });
    expect(shown()).toEqual(['APISIX refused: etcd down']);
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(shown()).toEqual([]);
  });

  it('while a dialog is open only the newest shows; an error raised then shows, for its whole time, after it closes', () => {
    vi.useFakeTimers();
    const { rerender } = render(withDialog(true));
    act(() => {
      toast.error('APISIX refused: etcd down');
      toast.info('Copied');
    });
    expect(shown()).toEqual(['Copied']);
    expect(document.querySelector('.ui-toast-viewport')).toHaveClass('ui-toast-viewport--modal');
    expect(moreRow()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(11000);
    });
    // The reviewer's sequence: 11 s later the error was never shown, so it is still to come.
    expect(getToasts().map((item) => item.message)).toEqual(['APISIX refused: etcd down']);
    rerender(withDialog(false));
    expect(shown()).toEqual(['APISIX refused: etcd down']);
    expect(document.querySelector('.ui-toast-viewport')).not.toHaveClass('ui-toast-viewport--modal');
    act(() => {
      vi.advanceTimersByTime(9500);
    });
    expect(shown()).toEqual(['APISIX refused: etcd down']);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(shown()).toEqual([]);
  });

  // Task 16b item 157: what waits behind "+N more" has not been seen: the row is never dismissed, and says what waits.
  it('"+N more" says how many errors wait, on the row and in its button\'s name, and says it again when the count changes', () => {
    render(<Toaster />);
    act(() => {
      toast.error('APISIX refused: etcd down');
      for (const n of [1, 2, 3]) toast.info(`Notice ${n}`);
    });
    const row = moreRow() as HTMLElement;
    expect(row).toHaveTextContent(t('ui.toast.moreError', { more: t('ui.toast.moreOne') }));
    expect(within(row).getByRole('button', { name: t('ui.toast.showMore', { more: t('ui.toast.moreError', { more: t('ui.toast.moreShort', { count: 1 }) }) }) })).toHaveTextContent(t('ui.toast.show'));
    const message = row.querySelector('.ui-toast__message') as HTMLElement;
    expect(message).toHaveAttribute('aria-live', 'polite');
    act(() => toast.info('Notice 4'));
    expect(moreRow()).toHaveTextContent(t('ui.toast.moreError', { more: t('ui.toast.more', { count: 2 }) }));
    act(() => {
      for (const item of getToasts()) dismissToast(item.id);
    });
    act(() => {
      toast.error('Refused once');
      toast.error('Refused twice');
      for (const n of [1, 2, 3]) toast.info(`Notice ${n}`);
    });
    expect(moreRow()).toHaveTextContent(t('ui.toast.moreErrors', { more: t('ui.toast.more', { count: 2 }), errors: 2 }));
  });

  it('Escape on the "+N more" row, or a swipe of it, shows what waits; nothing is dismissed', () => {
    render(<Toaster />);
    act(() => {
      toast.error('APISIX refused: etcd down');
      for (const n of [1, 2, 3]) toast.info(`Notice ${n}`);
    });
    const row = moreRow() as HTMLElement;
    row.focus();
    fireEvent.keyDown(row, { key: 'Escape' });
    expect(getToasts()).toHaveLength(4);
    expect(shown()).toEqual(['APISIX refused: etcd down', 'Notice 1', 'Notice 2', 'Notice 3']);

    act(() => toast.info('Notice 4'));
    act(() => {
      for (const item of getToasts().slice(0, 2)) dismissToast(item.id);
    });
    act(() => {
      for (const n of [5, 6, 7]) toast.info(`Notice ${n}`);
    });
    const again = moreRow() as HTMLElement;
    Object.assign(again, { setPointerCapture: () => {}, hasPointerCapture: () => true, releasePointerCapture: () => {} });
    fireEvent.pointerDown(again, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(again, { clientX: 30, clientY: 0 });
    fireEvent.pointerMove(again, { clientX: 120, clientY: 0 });
    fireEvent.pointerUp(again, { clientX: 120, clientY: 0 });
    expect(getToasts()).toHaveLength(6);
    expect(shown()).toEqual(['Notice 2', 'Notice 3', 'Notice 4', 'Notice 5', 'Notice 6', 'Notice 7']);
  });

  // Task 16b item 166: Escape typed elsewhere (a field, the code editor's completion) is not a dismissal.
  it('Escape pressed outside the toasts dismisses none; Escape on a toast dismisses that one', () => {
    render(
      <>
        <input aria-label="search" />
        <Toaster />
      </>,
    );
    act(() => {
      toast.error('APISIX refused: etcd down');
      toast.info('Copied');
    });
    const field = screen.getByRole('textbox', { name: 'search' });
    field.focus();
    fireEvent.keyDown(field, { key: 'Escape' });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(getToasts().map((item) => item.message)).toEqual(['APISIX refused: etcd down', 'Copied']);
    const copied = [...document.querySelectorAll<HTMLElement>('.ui-toast')].find((el) => el.textContent?.includes('Copied')) as HTMLElement;
    copied.focus();
    fireEvent.keyDown(copied, { key: 'Escape' });
    expect(getToasts().map((item) => item.message)).toEqual(['APISIX refused: etcd down']);
  });

  // Fix round 1, F1: an Escape that is not about a toast is left to what it is about, as with no toast on screen.
  it('Escape outside the toasts is not marked handled: a field still sees it, and a CodeMirror Escape binding runs', async () => {
    const { EditorView, keymap } = await import('@codemirror/view');
    const { EditorState } = await import('@codemirror/state');
    let escapes = 0;
    render(<Toaster />);
    const host = document.body.appendChild(document.createElement('div'));
    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: '{}', extensions: [keymap.of([{ key: 'Escape', run: () => ((escapes += 1), true) }])] }),
    });
    act(() => toast.error('Fix 1 problem before saving'));
    view.contentDOM.focus();
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    view.contentDOM.dispatchEvent(event);
    expect(escapes).toBe(1);
    expect(getToasts().map((item) => item.message)).toEqual(['Fix 1 problem before saving']);
    const field = document.body.appendChild(document.createElement('input'));
    field.focus();
    const plain = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    field.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
    view.destroy();
    host.remove();
    field.remove();
  });

  it('a dialog opened before a toast closes on the first Escape, and the toast stays', () => {
    const closed = vi.fn();
    function Page() {
      return (
        <>
          <Toaster />
          <Dialog open onClose={closed} title="Route web as JSON">
            <button type="button">Copy</button>
          </Dialog>
        </>
      );
    }
    render(<Page />);
    act(() => toast.info('Copied'));
    const copy = screen.getByRole('button', { name: 'Copy' });
    copy.focus();
    fireEvent.keyDown(copy, { key: 'Escape' });
    expect(closed).toHaveBeenCalledTimes(1);
    expect(getToasts().map((item) => item.message)).toEqual(['Copied']);
  });

  it('a menu opened before a toast closes on the first Escape, and the toast stays', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Toaster />
        <Menu trigger={<button type="button">Actions</button>} items={[{ id: 'edit', label: 'Edit', onSelect: () => {} }]} />
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Actions' }));
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    act(() => toast.info('Copied'));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(getToasts().map((item) => item.message)).toEqual(['Copied']);
  });

  // Fix round 2, R1.1: a tooltip holds no focus, so it takes its Escape itself: the first one closes it, and nothing else.
  describe('a keyboard-opened tooltip and Escape', () => {
    function Page({ inDialog }: { inDialog: boolean }) {
      const button = <Button icon={<Pencil size={14} />} aria-label="Edit route" />;
      return (
        <TooltipProvider>
          <Toaster />
          {inDialog ? (
            <Dialog open onClose={closed} title="Route web">
              <input aria-label="first" />
              {button}
            </Dialog>
          ) : (
            <>
              <input aria-label="first" />
              {button}
            </>
          )}
        </TooltipProvider>
      );
    }
    const closed = vi.fn();
    afterEach(() => closed.mockReset());

    it.each([
      ['on a page, with a toast showing', false, true],
      ['in a dialog, with a toast showing', true, true],
      ['in a dialog, with no toast', true, false],
    ])('%s: the first Escape closes the tooltip only', async (_, inDialog, withToast) => {
      const user = userEvent.setup();
      render(<Page inDialog={inDialog} />);
      screen.getByRole('textbox', { name: 'first' }).focus();
      await user.tab();
      expect(await screen.findByRole('tooltip')).toHaveTextContent('Edit route');
      if (withToast) act(() => toast.info('Copied'));
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
      expect(closed).not.toHaveBeenCalled();
      if (withToast) expect(getToasts().map((item) => item.message)).toEqual(['Copied']);
      if (inDialog) {
        await user.keyboard('{Escape}');
        expect(closed).toHaveBeenCalledTimes(1);
      }
      // The Escape the tooltip took leaves nothing behind in the toast: its close works at once.
      if (withToast) {
        fireEvent.click(screen.getByRole('button', { name: t('ui.toast.dismiss'), hidden: true }));
        expect(getToasts()).toEqual([]);
      }
    });
  });

  it('a page-bound refusal goes when the user moves to another page; every other toast stays, errors included', () => {
    render(<Toaster />);
    act(() => setToastPage('/routes/new'));
    act(() => {
      toast.success('Created route web');
      toast.error('Fix 1 problem before saving', { pageBound: true });
      toast.error("Can't delete: used by route shop");
      toast.info('Copied');
    });
    act(() => setToastPage('/routes/r1'));
    expect(getToasts().map((item) => item.message)).toEqual(['Created route web', "Can't delete: used by route shop", 'Copied']);
    // A page-bound one raised on the page the user is on stays while they are there.
    act(() => toast.error('Fix 2 problems before saving', { pageBound: true }));
    act(() => setToastPage('/routes/r1'));
    expect(getToasts().map((item) => item.message)).toContain('Fix 2 problems before saving');
    act(() => setToastPage('/services'));
    expect(getToasts().map((item) => item.message)).not.toContain('Fix 2 problems before saving');
    expect(screen.getByText("Can't delete: used by route shop")).toBeInTheDocument();
  });
});
