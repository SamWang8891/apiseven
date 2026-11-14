import { Tabs as RadixTabs } from 'radix-ui';
import type { ReactNode } from 'react';
import { t } from '../i18n';
import './tabs.css';

export interface TabsProps {
  tabs: { id: string; label: ReactNode; /** Error count; above zero shows a danger pill. */ badge?: number; content: ReactNode }[];
  active: string;
  onChange: (id: string) => void;
}

/** Tab strip plus panels. Arrow keys move between tabs; only the active panel is rendered. */
export function Tabs({ tabs, active, onChange }: TabsProps) {
  return (
    <RadixTabs.Root className="ui-tabs" value={active} onValueChange={onChange}>
      <RadixTabs.List className="ui-tabs__list">
        {tabs.map((tab) => (
          <RadixTabs.Trigger key={tab.id} value={tab.id} className="ui-tabs__tab">
            {tab.label}
            {tab.badge !== undefined && tab.badge > 0 && (
              <>
                {/* Separates the words in the accessible name; a flex container does not render it. */}{' '}
                <span className="ui-tabs__badge">
                  <span aria-hidden="true">{tab.badge}</span>
                  <span className="ui-sr-only">{t('ui.tabs.errors', { count: tab.badge })}</span>
                </span>
              </>
            )}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {tabs.map((tab) => (
        <RadixTabs.Content key={tab.id} value={tab.id} className="ui-tabs__panel">
          {tab.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}
