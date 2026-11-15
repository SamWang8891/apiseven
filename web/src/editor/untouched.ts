// Required values on a new object (Task 16b, item 154; item 126 is one case of it). Until a Save has
// been refused in the editing session, a problem that only says a required value is missing is not
// shown on a field the user has not touched and is not counted on a tab badge: a new page does not
// open in red. The first refused Save (button or Cmd/Ctrl-S) shows all of them, as before; a problem
// about a value the user entered shows at once. Save stays enabled (a refused Save is how the user
// learns what is missing), and it is refused for every problem, shown or not. As ruled in fix round
// 1 (R1):
// - "Only says a value is missing": the draft holds nothing at the problem's path (no value, null,
//   "", [] or {}), or the problem says so itself (Issue.missing: one about the object as a whole). A
//   problem whose path does not resolve in the draft (a map's rows named by place, a key that holds a
//   ".") is shown: fail open.
// - "Touched": the draft's value at the field's own path, or below it, has differed from the start
//   at some time in this session; nothing and nothing count as the same. A change above it (a plugin
//   card or a row added, an object pasted in the JSON tab) touches only what it put a value in. A
//   problem about the object as a whole is touched by nothing but a refused Save.
// One rule for every kind, in the frame (Editor.tsx); the kinds' checks are unchanged.
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { isObj } from '../api/sanitize';
import type { Obj } from '../api/types';
import { deepEqual, getPath, isEmptyValue } from './draft';
import type { Issue } from './issues';

/** Nothing there: no value, null, "", [] or {}. */
const nothing = (v: unknown): boolean => v === null || isEmptyValue(v);
const same = (a: unknown, b: unknown): boolean => deepEqual(a, b) || (nothing(a) && nothing(b));
const container = (v: unknown): v is Obj | unknown[] => isObj(v) || Array.isArray(v);
const keysOf = (v: unknown): string[] => (Array.isArray(v) ? v.map((_, i) => String(i)) : isObj(v) ? Object.keys(v) : []);
const childOf = (v: unknown, key: string): unknown => (Array.isArray(v) ? v[Number(key)] : isObj(v) ? v[key] : undefined);

/**
 * The dotted paths whose value differs from `before` to `after` (nothing and nothing the same): a
 * path that holds an object or a list on either side, and every path below it that differs, so what
 * a new row or plugin card brings in is recorded only where it holds a value.
 */
export function changedPaths(before: unknown, after: unknown, prefix = ''): string[] {
  if (same(before, after)) return [];
  if (!container(before) && !container(after)) return [prefix];
  const at = (key: string) => (prefix === '' ? key : `${prefix}.${key}`);
  const keys = new Set([...keysOf(before), ...keysOf(after)]);
  const below = [...keys].flatMap((key) => changedPaths(childOf(before, key), childOf(after, key), at(key)));
  // Two containers that differ only in what counts as nothing (an empty key) did not change.
  return below.length > 0 || !(container(before) && container(after)) ? [prefix, ...below] : [];
}

/** Whether `issue` only says that a required value is missing (and its path resolves in the draft). */
export function onlyMissing(issue: Issue, draft: Obj): boolean {
  if (issue.missing === true) return true;
  if (issue.path === '') return false;
  const parts = issue.path.split('.');
  return container(getPath(draft, parts.slice(0, -1))) && nothing(getPath(draft, parts));
}

/** Whether the user changed the draft at `path` or below it; never for the object as a whole. */
export function touchedAt(path: string, touched: ReadonlySet<string>): boolean {
  if (path === '') return false;
  for (const q of touched) if (q === path || q.startsWith(`${path}.`)) return true;
  return false;
}

const NONE: ReadonlySet<string> = new Set();

/**
 * The paths of `draft` the user has changed in this editing session (`noteEdit(next)`, called with
 * every change before it is made); `on` false records nothing (a stored object: the rule is for new ones).
 */
export function useTouched(draft: Obj, on: boolean): { touched: ReadonlySet<string>; noteEdit: (next: Obj) => void } {
  // Frame editing state: a new object's page is one editing session, until its Create.
  const [touched, setTouched] = useState(NONE);
  const current = useRef(draft);
  useLayoutEffect(() => {
    current.current = draft;
  });
  const noteEdit = useCallback(
    (next: Obj) => {
      if (!on) return;
      // Two changes in one event (a pair of PEM boxes) build the second from the first: both are in `next`.
      const paths = changedPaths(current.current, next);
      if (paths.length > 0) setTouched((prev) => (paths.every((p) => prev.has(p)) ? prev : new Set([...prev, ...paths])));
    },
    [on],
  );
  return { touched, noteEdit };
}

/**
 * The rule as the frame applies it: the issues shown now (all of them once a Save was refused, or on
 * a stored object), `noteEdit` for every change the user makes, and whether the ID field waits too:
 * a missing id, or one with a part missing (a secret's "vault/": item 126), until it is typed in.
 */
export function useRequiredValues(a: { isNew: boolean; attempted: boolean; draft: Obj; issues: Issue[]; createId: string | undefined; idWithSlash?: boolean }) {
  const { touched, noteEdit } = useTouched(a.draft, a.isNew);
  const quiet = a.isNew && !a.attempted;
  const { issues, draft } = a;
  const shown = useMemo(() => (quiet ? issues.filter((issue) => !onlyMissing(issue, draft) || touchedAt(issue.path, touched)) : issues), [quiet, issues, draft, touched]);
  // Frame editing state: the ID field was typed in.
  const [idTouched, setIdTouched] = useState(false);
  const idTyped = useCallback(() => setIdTouched(true), []);
  return {
    shown,
    noteEdit,
    idWaits: quiet && !idTouched,
    idPartMissing: a.createId !== undefined && a.idWithSlash === true && a.createId.split('/').some((part) => part === ''),
    idTyped,
  };
}
