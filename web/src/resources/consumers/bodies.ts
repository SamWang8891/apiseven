// The consumer editor's tab bodies, in one module so they arrive in one lazily loaded chunk (tabs.tsx):
// opening a consumer fetches it once, and every tab is there after that.
export { CredentialsTab } from './CredentialsTab';
export { GeneralTab } from './GeneralTab';
