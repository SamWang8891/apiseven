// The stream route editor's tab bodies, in one module so they arrive in one lazily loaded chunk
// (tabs.tsx): opening a stream route fetches it once, and every tab is there after that.
export { AdvancedTab } from './AdvancedTab';
export { GeneralTab } from './GeneralTab';
export { MatchingTab } from './MatchingTab';
export { UpstreamTab } from './UpstreamTab';
