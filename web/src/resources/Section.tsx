// A titled, collapsible part of an editor tab (the inline upstream form's sections, a rarely used
// field set). Collapsed, its header says in one line what it holds; a count of problems shows
// beside the title, and the section opens when one appears inside it. The body is not mounted while
// collapsed, so it holds nothing that matters: the values live in the draft, and a section whose
// field holds input it has not emitted (usePending) does not collapse (useHeld).
import { ChevronRight } from 'lucide-react';
import { useId, useRef, useState, type ReactNode } from 'react';
import { t } from '../i18n';
import { Badge, PendingScope, useHeld } from '../ui';
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
  const [open, setOpen] = useState(defaultOpen || issues > 0);
  const [seen, setSeen] = useState(issues);
  const held = useHeld();
  const bodyRef = useRef<HTMLDivElement>(null);
  if (issues !== seen) {
    setSeen(issues);
    if (issues > seen && !open) setOpen(true);
  }
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
