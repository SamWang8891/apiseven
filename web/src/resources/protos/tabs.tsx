// The proto editor's tabs: General and Content (the frame adds JSON). The bodies load lazily,
// together (bodies.ts).
import type { ReactNode } from 'react';
import { lazyPanel } from '../../editor/LazyPanel';
import { t } from '../../i18n';
import type { TabDef, TabProps } from '../registry';

type Bodies = typeof import('./bodies');

const loading = () => <p className="ed-lazy__loading">{t('editor.lazy.loading')}</p>;
const body = (pick: (m: Bodies) => (p: TabProps) => ReactNode) => lazyPanel<TabProps>(() => import('./bodies').then(pick), loading);

const General = body((m) => m.GeneralTab);
const Content = body((m) => m.ContentTab);

export const protoTabs: TabDef[] = [
  {
    id: 'general',
    get label() {
      return t('pr.tab.general');
    },
    fields: ['name', 'desc', 'labels'],
    render: (p) => <General {...p} />,
  },
  {
    id: 'content',
    get label() {
      return t('pr.tab.content');
    },
    fields: ['content'],
    render: (p) => <Content {...p} />,
  },
];
