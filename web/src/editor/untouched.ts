// Required values on a new object (Task 16b, item 154; item 126 is one case of it). Until a Save has
// been refused in the editing session, a problem that only says a required value is missing is not
// shown on a field the user has not touched and is not counted on a tab badge: a new page does not
// open in red. The first refused Save (button or Cmd/Ctrl-S) shows all of them, as before; a problem
// about a value the user entered shows at once. Save stays enabled (a refused Save is how the user
// learns what is missing), and it is refused for every problem, shown or not.
// - "Only says a value is missing": the draft holds nothing at the problem's path (no key, "", [] or
//   {}), or the problem says so itself (Issue.missing: one about the object as a whole).
// - "Touched": the user changed the draft at that path, below it, or above it (a whole object pasted
//   in the JSON tab); a problem about the object as a whole is touched by nothing but a refused Save.
// One rule for every kind, in the frame (Editor.tsx); the kinds' checks are unchanged.
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { isObj } from '../api/sanitize';
import type { Obj } from '../api/types';
import { deepEqual } from './draft';
import type { Issue } from './issues';

/** The dotted paths where `after` differs from `before`: the deepest that differ, a key or row present on one side only as a whole. */
export function changedPaths(before: unknown, after: unknown, prefix = ''): string[] {
  if (deepEqual(before, after)) return [];
  const at = (key: string | number) => (prefix === '' ? String(key) : `${prefix}.${String(key)}`);
  if (isObj(before) && isObj(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].flatMap((key) => (Object.hasOwn(before, key) && Object.hasOwn(after, key) ? changedPaths(before[key], after[key], at(key)) : [at(key)]));
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    return Array.from({ length: Math.max(before.length, after.length) }, (_, i) => (i < before.length && i < after.length ? changedPaths(before[i], after[i], at(i)) : [at(i)])).flat();
  }
  return [prefix];
}

/** The draft's value at a dotted path (array rows by number). */
function valueAt(draft: Obj, path: string): unknown {
  let at: unknown = draft;
  for (const key of path.split('.')) {
    if (Array.isArray(at)) at = at[Number(key)];
    else if (isObj(at)) at = at[key];
    else return undefined;
  }
  return at;
}

const empty = (value: unknown): boolean =>
  value === undefined || value === '' || (Array.isArray(value) && value.length === 0) || (isObj(value) && Object.keys(value).length === 0);

/** Whether `issue` only says that a required value is missing. */
export const onlyMissing = (issue: Issue, draft: Obj): boolean => issue.missing === true || (issue.path !== '' && empty(valueAt(draft, issue.path)));

/** Whether the user changed the draft at `path`, below it or above it; never for the object as a whole. */
export function touchedAt(path: string, touched: ReadonlySet<string>): boolean {
  if (path === '') return false;
  for (const q of touched) if (q === path || q.startsWith(`${path}.`) || path.startsWith(`${q}.`)) return true;
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
