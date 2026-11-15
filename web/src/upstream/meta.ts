// The upstream form's sections: ids, labels and the top-level upstream keys each one owns. Light on
// purpose: the editor's tab list and issue attribution need this in the main bundle, while the
// section bodies (sections.tsx) load with the form.
import { t } from '../i18n';

export type SectionId = 'nodes' | 'balancing' | 'health' | 'connection' | 'tls';

export interface SectionMeta {
  id: SectionId;
  label: string;
  /** Top-level upstream keys the section owns. */
  fields: string[];
}

// Labels are getters, so they follow the language table at use; build new entries, never spread one.
export const SECTION_META: SectionMeta[] = [
  {
    id: 'nodes',
    get label() {
      return t('up.section.nodes');
    },
    fields: ['nodes', 'discovery_type', 'service_name', 'discovery_args'],
  },
  {
    id: 'balancing',
    get label() {
      return t('up.section.balancing');
    },
    fields: ['type', 'hash_on', 'key', 'warm_up_conf'],
  },
  {
    id: 'health',
    get label() {
      return t('up.section.health');
    },
    fields: ['checks'],
  },
  {
    id: 'connection',
    get label() {
      return t('up.section.connection');
    },
    fields: ['scheme', 'retries', 'retry_timeout', 'timeout', 'keepalive_pool', 'pass_host', 'upstream_host'],
  },
  {
    id: 'tls',
    get label() {
      return t('up.section.tls');
    },
    fields: ['tls'],
  },
];

/** What the standalone editor's General tab owns (an inline upstream has no such tab). */
export const GENERAL_FIELDS = ['name', 'desc', 'labels'];

/** The section owning a top-level key; undefined for keys no section owns. */
export function sectionOfField(field: string): SectionId | undefined {
  return SECTION_META.find((s) => s.fields.includes(field))?.id;
}

/** The algorithms APISIX ships (apisix/balancer/*.lua); the schema leaves `type` an open string. */
export const BALANCERS = ['roundrobin', 'chash', 'ewma', 'least_conn'] as const;

/** What `type` is when unset (schema default). */
export const DEFAULT_TYPE = 'roundrobin';

/** The balancer's display name: ours for the known ones, else the value itself. */
export function balancerLabel(type: string): string {
  return (BALANCERS as readonly string[]).includes(type) ? t(`up.balance.${type}`) : type;
}

/** `scheme` when unset (schema default). */
export const DEFAULT_SCHEME = 'http';

/** The schemes of an L4 (stream) upstream (schema_def.lua 549–557: "For L4 proxy, it can be one of tcp/tls/udp"). */
export const STREAM_SCHEMES = ['tcp', 'tls', 'udp'];

/** What an unset (or `http`) scheme is for a stream upstream: filter_upstream makes it tcp (apisix/upstream.lua 763–766). */
export const DEFAULT_STREAM_SCHEME = 'tcp';
