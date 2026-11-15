// Whether an id can be addressed in the Admin API's path (fix round 2, R4). nginx decodes the path
// before APISIX routes it, so an id holding a slash, or one that is `.` or `..`, would address
// another resource ("a/credentials/b" a credential, ".." the parent collection). The API client's
// path builder refuses such ids before any request, and the router shows Not found for them. A kind
// whose ids hold one slash (a secret: "<manager>/<name>") is split by that rule and each part judged.
import type { Kind } from './types';

/** Whether `part` stays one path segment once decoded: not empty, not `.` or `..`, no slash. */
export const isSegment = (part: string): boolean => part !== '' && part !== '.' && part !== '..' && !part.includes('/');

/** The path segments of an id of `kind` (a secret's two, any other one), or undefined when it can't be addressed. */
export function idSegments(kind: Kind, id: string): string[] | undefined {
  const parts = kind === 'secrets' ? id.split('/') : [id];
  if (kind === 'secrets' && parts.length !== 2) return undefined;
  return parts.every(isSegment) ? parts : undefined;
}
