import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { Toast } from 'radix-ui';
import { useSyncExternalStore } from 'react';
import { t } from '../i18n';
import { useModalOpen } from './modal';
import { dismissToast, getToasts, subscribeToasts, type ToastTone } from './toast';
import { LabelTip } from './Tooltip';
import './overlay.css';

const ICONS: Record<ToastTone, typeof Info> = { success: CircleCheck, error: CircleAlert, info: Info };

/** Errors stay longer, and are announced assertively. Hovering or focusing a toast pauses it. */
const DURATION: Record<ToastTone, number> = { success: 4000, info: 5000, error: 10000 };

/**
 * Shows the toasts raised with `toast.*` (at most MAX_TOASTS; a repeat replaces its twin and says
 * ×N). Mount once, near the app root. F8 focuses the stack. They sit at the bottom right, above a
 * list's pager; while a dialog is open only the newest shows, centred in the band under the dialog
 * (overlay.css keeps a dialog clear of the bottom 12% of the window), so none covers its buttons.
 */
export function Toaster() {
  const items = useSyncExternalStore(subscribeToasts, getToasts, getToasts);
  const modal = useModalOpen();
  const newest = items.at(-1)?.id;
  return (
    <Toast.Provider label={t('ui.toast.label')} swipeDirection="right">
      {items.map(({ id, tone, message, action, count }) => {
        const Icon = ICONS[tone];
        // Collapsed, not unmounted, while a dialog is open: their order and their timers stay.
        const collapsed = modal && id !== newest;
        return (
          <Toast.Root
            key={id}
            className={`ui-toast ui-toast--${tone}${collapsed ? ' ui-toast--collapsed' : ''}`}
            type={tone === 'error' ? 'foreground' : 'background'}
            duration={DURATION[tone]}
            onOpenChange={(open) => !open && dismissToast(id)}
          >
            <Icon className="ui-toast__icon" aria-hidden="true" size={16} strokeWidth={2.25} />
            <Toast.Description className="ui-toast__message">
              {message}
              {/* Visual only: the repeat is announced again as it is. */}
              {count > 1 && (
                <span className="ui-toast__count" aria-hidden="true">
                  {t('ui.toast.repeat', { count })}
                </span>
              )}
            </Toast.Description>
            {action && (
              <Toast.Action asChild altText={action.label}>
                <a className="ui-toast__action" href={action.href}>
                  {action.label}
                </a>
              </Toast.Action>
            )}
            <LabelTip label={t('ui.toast.dismiss')}>
              <Toast.Close className="ui-toast__close" aria-label={t('ui.toast.dismiss')}>
                <X aria-hidden="true" size={14} />
              </Toast.Close>
            </LabelTip>
          </Toast.Root>
        );
      })}
      <Toast.Viewport className={modal ? 'ui-toast-viewport ui-toast-viewport--modal' : 'ui-toast-viewport'} label={t('ui.toast.region')} />
    </Toast.Provider>
  );
}
