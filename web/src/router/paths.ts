import type { Kind, Parent } from '../api/types';

/**
 * Kinds with a top-level URL segment, which is the Kind string itself. Credentials are not here:
 * they live under their consumer, at /consumers/<username>/credentials/<id>.
 */
const TOP_LEVEL = new Set<string>([
  'routes',
  'services',
  'upstreams',
  'consumers',
  'consumer_groups',
  'ssls',
  'global_rules',
  'plugin_configs',
  'plugin_metadata',
  'protos',
  'secrets',
  'stream_routes',
] satisfies Exclude<Kind, 'credentials'>[]);

const enc = encodeURIComponent;

function base(kind: Kind, parent?: Parent): string {
  if (kind !== 'credentials') return `/${kind}`;
  if (!parent) throw new Error('credentials need a parent consumer');
  return `/consumers/${enc(parent.consumer)}/credentials`;
}

/**
 * The hash-route path of a kind's list, or of one object when `id` is given. Ids are encoded, so
 * `a/b` stays one segment; the router hands them back decoded. Credentials need their consumer.
 * Not for the create page: use newPathFor (an object whose ID is literally "new" can't be opened).
 */
export function pathFor(kind: Kind, id?: string, parent?: Parent): string {
  if (kind === 'credentials' && id === undefined) throw new Error('credentials have no list page of their own');
  return id === undefined ? base(kind, parent) : `${base(kind, parent)}/${enc(id)}`;
}

/** The create page of a kind: /routes/new, /consumers/<username>/credentials/new. */
export function newPathFor(kind: Kind, parent?: Parent): string {
  return `${base(kind, parent)}/new`;
}

/** The kind a top-level URL segment names, exactly as written; undefined for anything else. */
export function kindFromSegment(segment: string | undefined): Kind | undefined {
  return segment !== undefined && TOP_LEVEL.has(segment) ? (segment as Kind) : undefined;
}
