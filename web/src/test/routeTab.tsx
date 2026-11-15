// Renders one tab of the route editor the way the frame does (see renderTab in tab.tsx), with issues
// from routeIssues.
import type { ComponentType } from 'react';
import type { Obj } from '../api/types';
import type { TabProps } from '../resources/registry';
import { routeIssues } from '../resources/routes/validate';
import { renderTab, type TabOptions } from './tab';

export type RouteTabOptions = TabOptions;

export function renderRouteTab(Tab: ComponentType<TabProps>, initial: Obj, opts: RouteTabOptions = {}) {
  return renderTab('routes', Tab, initial, routeIssues, opts);
}
