// The plugin config editor's tab bodies, in one module so they arrive in one lazily loaded chunk
// (tabs.tsx): opening a plugin config fetches it once, and every tab is there after that.
export { GeneralTab } from './GeneralTab';
export { PluginsBody } from './PluginsBody';
export { UsedByTab } from './UsedByTab';
