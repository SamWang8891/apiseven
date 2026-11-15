import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { Toast } from 'radix-ui';
import { useSyncExternalStore } from 'react';
import { t } from '../i18n';
import { dismissToast, getToasts, subscribeToasts, type ToastTone } from './toast';
import './overlay.css';

const ICONS: Record<ToastTone, typeof Info> = { success: CircleCheck, error: CircleAlert, info: Info };

/** Errors stay longer, and are announced assertively. Hovering or focusing a toast pauses it. */
const DURATION: Record<ToastTone, number> = { success: 4000, info: 5000, error: 10000 };

/** Shows the toasts raised with `toast.*`. Mount once, near the app root. F8 focuses the stack. */
export function Toaster() {
  const items = useSyncExternalStore(subscribeToasts, getToasts, getToasts);
  return (
    <Toast.Provider label={t('ui.toast.label')} swipeDirection="right">
      {items.map(({ id, tone, message, action }) => {
        const Icon = ICONS[tone];
        return (
          <Toast.Root
            key={id}
            className={`ui-toast ui-toast--${tone}`}
            type={tone === 'error' ? 'foreground' : 'background'}
            duration={DURATION[tone]}
            onOpenChange={(open) => !open && dismissToast(id)}
          >
            <Icon className="ui-toast__icon" aria-hidden="true" size={16} strokeWidth={2.25} />
            <Toast.Description className="ui-toast__message">{message}</Toast.Description>
            {action && (
              <Toast.Action asChild altText={action.label}>
                <a className="ui-toast__action" href={action.href}>
                  {action.label}
                </a>
              </Toast.Action>
            )}
            <Toast.Close className="ui-toast__close" aria-label={t('ui.toast.dismiss')}>
              <X aria-hidden="true" size={14} />
            </Toast.Close>
          </Toast.Root>
        );
      })}
      <Toast.Viewport className="ui-toast-viewport" label={t('ui.toast.region')} />
    </Toast.Provider>
  );
}
