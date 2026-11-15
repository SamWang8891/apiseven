// A new object's id, and what the frame refuses of it (fix round 1, R4). An id ends up in the Admin
// API's path (api/client.ts), which nginx decodes before APISIX routes it: an id holding a slash, or
// one that is `.` or `..`, would address another resource (a consumer "a/credentials/b" writes a
// credential, ".." climbs out of the kind). So whatever a kind's own rules say, the frame refuses
// such an id, for a plain Save as for Save anyway; a kind whose ids hold one slash (a secret's
// "<manager>/<id>") has each of its segments checked instead. A missing id, or one the kind's id rule
// refuses (ResourceDef.idProblem: a consumer's username pattern too), is the frame's refusal as well,
// never one of the kind's validation issues that Save anyway could send past. Pure.
import { isSegment } from '../api/segments';
import type { Obj } from '../api/types';
import { t } from '../i18n';
import type { ResourceDef } from '../resources/registry';

type IdRules = Pick<ResourceDef, 'idFromDraft' | 'idMode' | 'idProblem' | 'idWithSlash'>;

/** Why `id` would not stay what it is in the Admin API's path, or undefined. */
export function segmentProblem(id: string, withSlash = false): string | undefined {
  const segments = withSlash ? id.split('/') : [id];
  // An empty part is the kind's own rule's to name (a secret's "Enter the ID after the manager").
  return segments.some((segment) => segment !== '' && !isSegment(segment)) ? t('editor.id.segment', { id }) : undefined;
}

export interface NewIdState {
  /** The id typed into the JSON, if any. */
  typedId: string | undefined;
  /** What a new object is created under (undefined: none, or APISIX generates one). */
  createId: string | undefined;
  /** A required id is missing. */
  missing: boolean;
  /** Why the id is refused, if it is. */
  refused: string | undefined;
}

/**
 * A new object's id: the body field for kinds that have one (a consumer's username); else the one the
 * page fixes, the ID field, or an id typed into the JSON (POST refuses an id in the body). For a
 * stored object only `typedId` matters (the frame's check that it doesn't change, issues.ts).
 */
export function newIdState(def: IdRules, draft: Obj, a: { isNew: boolean; fixedId?: string; newId: string }): NewIdState {
  const typedId = typeof draft.id === 'string' || typeof draft.id === 'number' ? String(draft.id) : undefined;
  const createId = def.idFromDraft ? def.idFromDraft(draft) : (a.fixedId ?? (a.newId.trim() || typedId));
  const missing = a.isNew && def.idMode !== 'optional' && createId === undefined;
  // An id of "" (typed into the JSON) is no id the path can hold, and not "no id": refused (Task 16b, item 142).
  const refused = a.isNew && createId !== undefined ? (def.idProblem?.(createId) ?? (createId === '' ? t('editor.id.empty') : segmentProblem(createId, def.idWithSlash))) : undefined;
  return { typedId, createId, missing, refused };
}
