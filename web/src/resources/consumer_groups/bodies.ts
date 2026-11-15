// The consumer group editor's tab bodies, in one module so they arrive in one lazily loaded chunk
// (tabs.tsx): opening a group fetches it once, and every tab is there after that.
export { GeneralTab } from './GeneralTab';
export { MembersTab } from './MembersTab';
