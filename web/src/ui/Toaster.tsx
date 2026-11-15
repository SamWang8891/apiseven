import { ChevronUp, CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { Toast } from 'radix-ui';
import { useState, useSyncExternalStore } from 'react';
import { t } from '../i18n';
import { useModalOpen } from './modal';
import { dismissToast, getToasts, MAX_VISIBLE, subscribeToasts, type ToastItem, type ToastTone } from './toast';
import { LabelTip } from './Tooltip';
import './overlay.css';

const ICONS: Record<ToastTone, typeof Info> = { success: CircleCheck, error: CircleAlert, info: Info };

/** Errors stay longer, and are announced assertively. Hovering or focusing a toast pauses it. */
const DURATION: Record<ToastTone, number> = { success: 4000, info: 5000, error: 10000 };

/**
 * Shows the toasts raised with `toast.*` (a repeat replaces its twin and says ×N). Mount once, near
 * the app root. F8 focuses the stack. They sit at the bottom right, above a list's pager.
 *
 * Only what shows counts down: a toast is mounted (and its time starts) when it becomes visible, and
 * one that is not visible is not mounted, so its time does not run. That is the case for:
 * - toasts beyond the newest MAX_VISIBLE: they wait, collapsed, behind a "+N more" row that shows
 *   them all (and that a swipe or Escape clears);
 * - while a dialog is open, every toast but the newest, which sits centred in the band under the
 *   dialog (overlay.css keeps a dialog clear of the bottom 12% of the window), so none covers its
 *   buttons. The others come back, with their full time, when it closes.
 * The stack keeps the order the toasts were raised in, whatever order they were mounted in.
 */
export function Toaster() {
  const items = useSyncExternalStore(subscribeToasts, getToasts, getToasts);
  const modal = useModalOpen();
  const [expanded, setExpanded] = useState(false);
  // Expanded lasts while there is something to expand.
  if (expanded && items.length <= MAX_VISIBLE) setExpanded(false);
  const visible = modal ? items.slice(-1) : expanded ? items : items.slice(-MAX_VISIBLE);
  const waiting = modal ? [] : items.slice(0, items.length - visible.length);
  const order = new Map(items.map((item, i) => [item.id, i]));
  return (
    <Toast.Provider label={t('ui.toast.label')} swipeDirection="right">
      {waiting.length > 0 && <MoreRow count={waiting.length} onShow={() => setExpanded(true)} onClear={() => waiting.forEach((item) => dismissToast(item.id))} />}
      {visible.map((item) => (
        <OneToast key={item.id} item={item} order={order.get(item.id) ?? 0} />
      ))}
      <Toast.Viewport className={modal ? 'ui-toast-viewport ui-toast-viewport--modal' : 'ui-toast-viewport'} label={t('ui.toast.region')} />
    </Toast.Provider>
  );
}

function OneToast({ item, order }: { item: ToastItem; order: number }) {
  const { id, tone, message, action, count } = item;
  const Icon = ICONS[tone];
  return (
    <Toast.Root
      className={`ui-toast ui-toast--${tone}`}
      style={{ order }}
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
}

/** "2 more notifications · Show": the older toasts waiting behind the visible ones. It never times out. */
function MoreRow({ count, onShow, onClear }: { count: number; onShow: () => void; onClear: () => void }) {
  return (
    <Toast.Root className="ui-toast ui-toast--more" style={{ order: -1 }} type="background" duration={Infinity} open onOpenChange={(open) => !open && onClear()}>
      <Toast.Description className="ui-toast__message">{count === 1 ? t('ui.toast.moreOne') : t('ui.toast.more', { count })}</Toast.Description>
      {/* Not a Toast.Action: that would close the row (and clear what waits) instead of showing it. */}
      <button type="button" className="ui-toast__show" onClick={onShow}>
        <ChevronUp aria-hidden="true" size={14} />
        {t('ui.toast.show')}
      </button>
    </Toast.Root>
  );
}
