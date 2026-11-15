import { useMemo } from 'react';
import { useSupportsAll } from '../api/hooks';
import type { TabDef } from '../resources/registry';

/**
 * A kind's tabs, without those whose kind (TabDef.requires) this APISIX turns out to lack: a
 * consumer's Credentials tab on an APISIX before 3.11. Shown while that is still being asked.
 */
export function useShownTabs(tabs: TabDef[]): TabDef[] {
  const gates = useMemo(() => [...new Set(tabs.flatMap((tab) => (tab.requires ? [tab.requires] : [])))], [tabs]);
  const support = useSupportsAll(gates);
  // A string, so the list below keeps its identity while the answers stay the same.
  const lacking = gates.filter((gate) => support[gate] === false).join(' ');
  return useMemo(() => {
    const missing = new Set(lacking.split(' '));
    return tabs.filter((tab) => !tab.requires || !missing.has(tab.requires));
  }, [tabs, lacking]);
}
