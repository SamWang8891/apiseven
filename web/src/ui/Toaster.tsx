import { ChevronUp, CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { Toast } from 'radix-ui';
import { useRef, useState, useSyncExternalStore } from 'react';
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
 *   them all (as do a swipe of it and Escape on it: what waits has not been seen, so nothing clears it);
 * - while a dialog is open, every toast but the newest, which sits centred in the band under the
 *   dialog (overlay.css keeps a dialog clear of the bottom 12% of the window), so none covers its
 *   buttons. The others come back, with their full time, when it closes.
 * The stack keeps the order the toasts were raised in, whatever order they were mounted in. Escape
 * dismisses a toast only while focus is in it. One pressed elsewhere (a field, the code editor's
 * completion, an overlay opened before the toast) is neither a dismissal nor marked handled: it does
 * what it does with no toast on screen (an overlay below closes through ui/escape.ts).
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
      {waiting.length > 0 && <MoreRow count={waiting.length} errors={waiting.filter((item) => item.tone === 'error').length} onShow={() => setExpanded(true)} />}
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
  /** Set while Radix closes this toast for an Escape that was not about it: that close is ignored. */
  const declined = useRef(false);
  return (
    <Toast.Root
      className={`ui-toast ui-toast--${tone}`}
      style={{ order }}
      type={tone === 'error' ? 'foreground' : 'background'}
      duration={DURATION[tone]}
      // Open while it is in the store: Radix asks to close it (time, swipe, the close button, Escape on it).
      open
      onOpenChange={(open) => {
        if (open) return;
        if (declined.current) declined.current = false;
        else dismissToast(id);
      }}
      // An Escape pressed elsewhere is not marked handled (CodeMirror, a field, an overlay below take it:
      // ui/escape.ts); Radix then closes this toast, which is declined.
      onEscapeKeyDown={(e) => {
        // Not when something before it took the key (an open tooltip): Radix then asks for no close.
        if (!inToast(e.target) && !e.defaultPrevented) declined.current = true;
      }}
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

/** Whether a key event's target is in a toast (Escape there is meant for it). */
const inToast = (target: EventTarget | null): boolean => target instanceof Element && target.closest('.ui-toast') !== null;

/** `more` and, when errors wait among them, how many. */
const withErrors = (more: string, errors: number): string =>
  errors === 0 ? more : errors === 1 ? t('ui.toast.moreError', { more }) : t('ui.toast.moreErrors', { more, errors });

/**
 * "2 more notifications, 1 error · Show": the older toasts waiting behind the visible ones. It never
 * times out and is never dismissed (nothing behind it was seen): Escape on it and a swipe show them.
 * A change of what waits is announced.
 */
function MoreRow({ count, errors, onShow }: { count: number; errors: number; onShow: () => void }) {
  return (
    <Toast.Root
      className="ui-toast ui-toast--more"
      style={{ order: -1 }}
      type="background"
      duration={Infinity}
      open
      onOpenChange={() => {}}
      // Escape on it shows what waits; one pressed elsewhere is left unhandled (OneToast), and the close
      // Radix then asks for is ignored like every other.
      onEscapeKeyDown={(e) => {
        if (!inToast(e.target)) return;
        e.preventDefault();
        onShow();
      }}
      onSwipeStart={(e) => e.preventDefault()}
      onSwipeMove={(e) => e.preventDefault()}
      onSwipeEnd={(e) => {
        e.preventDefault();
        onShow();
      }}
    >
      <Toast.Description className="ui-toast__message" aria-live="polite" aria-atomic="true">
        {withErrors(count === 1 ? t('ui.toast.moreOne') : t('ui.toast.more', { count }), errors)}
      </Toast.Description>
      {/* Not a Toast.Action: that would close the row instead of showing what waits. */}
      <button type="button" className="ui-toast__show" aria-label={t('ui.toast.showMore', { more: withErrors(t('ui.toast.moreShort', { count }), errors) })} onClick={onShow}>
        <ChevronUp aria-hidden="true" size={14} />
        {t('ui.toast.show')}
      </button>
    </Toast.Root>
  );
}
