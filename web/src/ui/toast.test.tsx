import { act, render, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { ConfirmDialog } from './ConfirmDialog';
import { Dialog } from './Dialog';
import { Toaster } from './Toaster';
import { dismissToast, getToasts, MAX_TOASTS, setToastPage, toast, toastsRaised } from './toast';

// Known item 8: identical toasts do not stack, at most three show, none covers a dialog's buttons, and
// a refusal does not linger over the next page.

beforeEach(() => {
  for (const item of getToasts()) dismissToast(item.id);
});

/** The toasts on screen (a collapsed one is in the page, not shown). */
const toastEls = () => document.querySelectorAll('.ui-toast:not(.ui-toast--collapsed)');

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
    expect(toastEls()).toHaveLength(2);
    const repeated = [...toastEls()].find((el) => el.textContent?.includes('Fix 1 problem')) as HTMLElement;
    expect(within(repeated).getByText(t('ui.toast.repeat', { count: 3 }))).toBeInTheDocument();
    // The same words in another tone are another notice.
    act(() => toast.info('Saved'));
    expect(getToasts().filter((item) => item.message === 'Saved')).toHaveLength(2);
  });

  it(`shows at most ${MAX_TOASTS}: a new one pushes the oldest out`, () => {
    render(<Toaster />);
    act(() => {
      for (const n of [1, 2, 3, 4, 5]) toast.info(`Notice ${n}`);
    });
    expect(getToasts().map((item) => item.message)).toEqual(['Notice 3', 'Notice 4', 'Notice 5']);
    expect([...toastEls()].map((el) => el.textContent)).toEqual(['Notice 3', 'Notice 4', 'Notice 5']);
  });

  it('while a dialog is open only the newest shows, under it; the others come back when it closes', () => {
    const { rerender } = render(
      <>
        <Toaster />
        <Dialog open={false} onClose={() => {}} title="Replace certificate" footer={<button type="button">Use this pair</button>}>
          body
        </Dialog>
      </>,
    );
    act(() => {
      toast.error('Fix 1 problem before saving');
      toast.info('Copied');
    });
    expect(toastEls()).toHaveLength(2);
    const viewport = () => document.querySelector('.ui-toast-viewport');
    expect(viewport()).not.toHaveClass('ui-toast-viewport--modal');
    rerender(
      <>
        <Toaster />
        <Dialog open onClose={() => {}} title="Replace certificate" footer={<button type="button">Use this pair</button>}>
          body
        </Dialog>
      </>,
    );
    expect([...toastEls()].map((el) => el.textContent)).toEqual(['Copied']);
    expect(viewport()).toHaveClass('ui-toast-viewport--modal');
    rerender(
      <>
        <Toaster />
        <Dialog open={false} onClose={() => {}} title="Replace certificate">
          body
        </Dialog>
        <ConfirmDialog open title="Save anyway?" confirmLabel="Save anyway" onConfirm={() => {}} onCancel={() => {}} />
      </>,
    );
    expect(toastEls()).toHaveLength(1);
    rerender(
      <>
        <Toaster />
        <ConfirmDialog open={false} title="Save anyway?" confirmLabel="Save anyway" onConfirm={() => {}} onCancel={() => {}} />
      </>,
    );
    expect([...toastEls()].map((el) => el.textContent)).toEqual(['Fix 1 problem before saving', 'Copied']);
    expect(viewport()).not.toHaveClass('ui-toast-viewport--modal');
  });

  it('an error raised on one page goes when the user moves to another; success and info stay', () => {
    render(<Toaster />);
    act(() => setToastPage('/routes/new'));
    act(() => {
      toast.success('Created route web');
      toast.error('Fix 1 problem before saving');
      toast.info('Copied');
    });
    act(() => setToastPage('/routes/r1'));
    expect(getToasts().map((item) => item.message)).toEqual(['Created route web', 'Copied']);
    // An error raised on the page the user is on stays while they are there.
    act(() => toast.error('etcd down'));
    act(() => setToastPage('/routes/r1'));
    expect(getToasts().map((item) => item.message)).toContain('etcd down');
    act(() => setToastPage('/services'));
    expect(getToasts().map((item) => item.message)).not.toContain('etcd down');
  });
});
