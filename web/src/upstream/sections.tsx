// The upstream form's sections, shared by the standalone editor (one tab each) and the inline form
// (one collapsible Section each): which keys each owns (meta.ts), the one line that sums it up, and
// its fields. Each section writes only its own keys; everything else in the upstream is kept.
import type { ReactNode } from 'react';
import type { Obj } from '../api/types';
import { BalancingSection } from './BalancingSection';
import { ConnectionSection } from './ConnectionSection';
import type { SectionProps } from './values';
import { HealthChecks } from './HealthChecks';
import { SECTION_META, type SectionId, type SectionMeta } from './meta';
import { NodesSection } from './NodesSection';
import { SUMMARIES } from './summary';
import { TlsSection } from './TlsSection';

export interface UpstreamSection {
  id: SectionId;
  label: string;
  /** Top-level upstream keys the section owns. */
  fields: string[];
  /** One line about its values, shown while collapsed and in the locked overview, e.g. `2 nodes: a:80, b:80`. */
  summary(value: Obj): string;
  render(p: SectionProps): ReactNode;
}

const bodies: Record<SectionId, (p: SectionProps) => ReactNode> = {
  nodes: NodesSection,
  balancing: BalancingSection,
  health: HealthChecks,
  connection: ConnectionSection,
  tls: TlsSection,
};

function section(meta: SectionMeta): UpstreamSection {
  const Body = bodies[meta.id];
  return {
    id: meta.id,
    // A getter: the label follows the language table at use (never spread a section).
    get label() {
      return meta.label;
    },
    fields: meta.fields,
    summary: SUMMARIES[meta.id],
    render: (p) => <Body {...p} />,
  };
}

/** In form order: Nodes, Load balancing, Health checks, Connection, TLS. */
export const upstreamSections: UpstreamSection[] = SECTION_META.map(section);
