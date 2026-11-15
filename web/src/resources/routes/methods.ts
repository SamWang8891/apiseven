import type { Obj } from '../../api/types';

/** What the list shows for a route that sets no methods: it matches any. */
export const ANY_METHOD = 'ANY';

/** The methods a route matches, as the Methods column and the Method filter show them: ANY when it sets none. */
export function methodsOf(route: Obj): string[] {
  const methods = Array.isArray(route.methods) ? route.methods.filter((m): m is string => typeof m === 'string' && m !== '') : [];
  return methods.length > 0 ? methods : [ANY_METHOD];
}
