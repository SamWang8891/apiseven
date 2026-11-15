// The service editor's tab bodies, in one module so they arrive in one lazily loaded chunk (tabs.tsx):
// opening a service fetches it once, and every tab is there after that.
export { GeneralTab } from './GeneralTab';
export { RoutesTab } from './RoutesTab';
export { UpstreamTab } from './UpstreamTab';
