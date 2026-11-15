// A titled, collapsible part of an editor tab (the inline upstream form's sections, a rarely used
// field set). Collapsed, its header says in one line what it holds; a count of problems shows
// beside the title, and the section opens when one appears inside it. The body is not mounted while
// collapsed, so it holds nothing that matters: the values live in the draft, and a section whose
// field holds input it has not emitted (usePending) does not collapse (useHeld). Opened or closed by
// the user, it stays so for the editor page (ui/ViewMemory: a tab switch remounts it), by its title,
// until a Save is refused while a problem sits inside it: then it opens, as a card with one does.
import { ChevronRight } from 'lucide-react';
import { use, useId, useRef, type ReactNode } from 'react';
import { refusedSince, SaveRefusalsContext } from '../editor/saveRefusals';
import { t } from '../i18n';
import { Badge, PendingScope, useHeld, useViewState } from '../ui';
import './resources.css';

export interface SectionProps {
  title: ReactNode;
  /** One line about the values, shown (and used as the toggle's description) while collapsed. */
  summary?: ReactNode;
  /** Problems inside: a count beside the title; the section opens when it rises. */
  issues?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function Section({ title, summary, issues = 0, defaultOpen = false, children }: SectionProps) {
  const id = useId();
  const refusals = use(SaveRefusalsContext);
  /** Open or not, as of which refused Save that was decided, and with how many problems inside (kept with it, through a remount). */
  const [state, setState] = useViewState(typeof title === 'string' ? `section:${title}` : undefined, () => ({ open: defaultOpen || issues > 0, at: refusals, issues }));
  const { open } = state;
  const setOpen = (next: boolean | ((was: boolean) => boolean)) => setState((s) => ({ open: typeof next === 'function' ? next(s.open) : next, at: refusals, issues }));
  // More problems than when it was last seen (also while it was away: a tab switch) open it.
  if (issues !== state.issues) setState((s) => ({ open: s.open || issues > s.issues, at: s.at, issues }));
  // A Save refused since then, with a problem inside, opens it (also when this tab mounts after one).
  else if (!open && issues > 0 && refusedSince(refusals, state.at)) setState({ open: true, at: refusals, issues });
  const held = useHeld();
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleId = `${id}-title`;
  const summaryId = `${id}-summary`;
  const issuesId = `${id}-issues`;
  const showSummary = !open && summary !== undefined && summary !== '';
  const describedBy = [issues > 0 && issuesId, showSummary && summaryId].filter(Boolean).join(' ');

  return (
    <section className={open ? 'res-section res-section--open' : 'res-section'} aria-labelledby={titleId}>
      <button
        type="button"
        className="res-section__toggle"
        aria-expanded={open}
        aria-controls={open ? `${id}-body` : undefined}
        aria-labelledby={titleId}
        aria-describedby={describedBy || undefined}
        onClick={() => {
          if (!(open && held.refuse(bodyRef.current))) setOpen((o) => !o);
        }}
      >
        <ChevronRight className="res-section__chevron" size={15} aria-hidden="true" />
        <span className="res-section__title" id={titleId}>
          {title}
        </span>
        {issues > 0 && (
          <span className="res-section__issues" id={issuesId}>
            <Badge tone="danger">{t('ui.tabs.errors', { count: issues })}</Badge>
          </span>
        )}
        {showSummary && (
          <span className="res-section__summary" id={summaryId}>
            {summary}
          </span>
        )}
      </button>
      {open && (
        <div className="res-section__body" id={`${id}-body`} ref={bodyRef}>
          <PendingScope onChange={held.track}>{children}</PendingScope>
        </div>
      )}
    </section>
  );
}
