// The SSL editor's tab bodies, in one module so they arrive in one lazily loaded chunk (tabs.tsx):
// opening an SSL fetches it once, and every tab is there after that.
import './ssls.css';

export { CertificateTab } from './CertificateTab';
export { SnisTab } from './SnisTab';
export { ClientTab } from './ClientTab';
export { GeneralTab } from './GeneralTab';
