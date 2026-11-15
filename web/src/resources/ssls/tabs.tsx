// The SSL editor's tabs: Certificate, SNIs, Client mTLS and General (the frame adds JSON). Each tab's
// `fields` are the top-level keys it owns, which decide where an issue or APISIX's error is badged.
// The status is the header's switch. The bodies load lazily, together (bodies.ts).
import type { ReactNode } from 'react';
import { lazyPanel } from '../../editor/LazyPanel';
import { t } from '../../i18n';
import type { TabDef, TabProps } from '../registry';

type Bodies = typeof import('./bodies');

const loading = () => <p className="ed-lazy__loading">{t('editor.lazy.loading')}</p>;
const body = (pick: (m: Bodies) => (p: TabProps) => ReactNode) => lazyPanel<TabProps>(() => import('./bodies').then(pick), loading);

const Certificate = body((m) => m.CertificateTab);
const Snis = body((m) => m.SnisTab);
const Client = body((m) => m.ClientTab);
const General = body((m) => m.GeneralTab);

export const sslTabs: TabDef[] = [
  {
    id: 'certificate',
    get label() {
      return t('ssl.tab.certificate');
    },
    fields: ['cert', 'key', 'certs', 'keys'],
    render: (p) => <Certificate {...p} />,
  },
  {
    id: 'snis',
    get label() {
      return t('ssl.tab.snis');
    },
    fields: ['sni', 'snis'],
    render: (p) => <Snis {...p} />,
  },
  {
    id: 'client',
    get label() {
      return t('ssl.tab.client');
    },
    fields: ['client'],
    render: (p) => <Client {...p} />,
  },
  {
    id: 'general',
    get label() {
      return t('ssl.tab.general');
    },
    fields: ['type', 'desc', 'labels', 'ssl_protocols'],
    render: (p) => <General {...p} />,
  },
];
