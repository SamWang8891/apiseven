// The upstream form for editors that hold an upstream inline (a route's, a service's, a stream
// route's `upstream`). `sections`: each section a collapsible Section showing its one-line summary
// while collapsed; Nodes starts open, the others when they hold a value or a problem. `tabs`: the
// sections as an inner tab strip. Issues have paths relative to the upstream (`nodes.0.host`);
// those no section owns (the upstream as a whole) show above the sections.
import { useState, type FC } from 'react';
import type { Obj } from '../api/types';
import type { Issue } from '../editor/issues';
import { t } from '../i18n';
import type { Ctx } from '../resources/ctx';
import { Section } from '../resources/Section';
import { Tabs } from '../ui';
import { DEFAULT_TYPE } from './meta';
import { upstreamSections, type UpstreamSection } from './sections';
import './upstream.css';

export interface UpstreamFormProps {
  value: Obj;
  onChange: (v: Obj) => void;
  /** Paths relative to the upstream object ('nodes', 'timeout.connect'). */
  issues?: Issue[];
  ctx: Ctx;
  layout: 'tabs' | 'sections';
}

const NONE: Issue[] = [];
const topOf = (path: string): string => path.split('.')[0] ?? '';
const owns = (s: UpstreamSection, issue: Issue): boolean => s.fields.includes(topOf(issue.path));

/** Whether the section holds anything worth opening it for (`type: roundrobin` is what APISIX assumes anyway). */
function holdsValue(s: UpstreamSection, value: Obj): boolean {
  return s.fields.some((field) => value[field] !== undefined && !(field === 'type' && value[field] === DEFAULT_TYPE));
}

function Stray({ issues }: { issues: Issue[] }) {
  if (issues.length === 0) return null;
  return (
    <div className="up-alert" role="alert">
      <p className="up-alert__title">{t('up.issues')}</p>
      <ul className="up-alert__list">
        {issues.map((issue, i) => (
          <li key={i}>
            {issue.path !== '' && <code className="up-alert__path mono">{issue.path}</code>} {issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

export const UpstreamForm: FC<UpstreamFormProps> = ({ value, onChange, issues = NONE, ctx, layout }) => {
  const [active, setActive] = useState<string>(upstreamSections[0]?.id ?? 'nodes');
  const stray = issues.filter((issue) => !upstreamSections.some((s) => owns(s, issue)));
  const ownIssues = (s: UpstreamSection) => issues.filter((issue) => owns(s, issue));

  if (layout === 'tabs') {
    return (
      <div className="up up--tabs">
        <Stray issues={stray} />
        <Tabs
          active={active}
          onChange={setActive}
          tabs={upstreamSections.map((s) => ({
            id: s.id,
            label: s.label,
            badge: ownIssues(s).length,
            content: s.id === active ? s.render({ value, onChange, issues: ownIssues(s), ctx }) : null,
          }))}
        />
      </div>
    );
  }

  return (
    <div className="up up--sections">
      <Stray issues={stray} />
      <div className="up-sections">
        {upstreamSections.map((s) => {
          const own = ownIssues(s);
          return (
            <Section key={s.id} title={s.label} summary={s.summary(value)} issues={own.length} defaultOpen={s.id === 'nodes' || holdsValue(s, value) || own.length > 0}>
              {s.render({ value, onChange, issues: own, ctx })}
            </Section>
          );
        })}
      </div>
    </div>
  );
};
