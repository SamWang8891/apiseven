// The plugin metadata list's rows: every plugin this APISIX has loaded with a metadata schema
// (GET /plugins?all=true is the only place that publishes one), joined with the stored entries. A
// stored entry whose plugin is not loaded, or declares no metadata schema, is listed too, flagged:
// APISIX keeps and takes it (admin/plugin_metadata.lua 26–46: any plugin module on disk, with an
// empty schema injected when it has none). When the plugin list could not load, only the stored
// entries are listed, unflagged: what they are is not known.
import type { Item, PluginInfo } from '../../api/types';
import { t } from '../../i18n';

export interface MetadataRow extends Item {
  /** Something is stored for the plugin. */
  configured: boolean;
  /** A stored entry whose plugin isn't loaded here, or declares no metadata schema. */
  flag?: 'unknown' | 'noSchema';
  /** The stored entry, as listed. */
  stored?: Item;
}

const byName = (a: MetadataRow, b: MetadataRow): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The rows, by plugin name; `plugins` undefined: the list failed, so the stored entries alone. */
export function metadataRows(plugins: Record<string, PluginInfo> | undefined, stored: Item[]): MetadataRow[] {
  const byId = new Map(stored.map((item) => [item.id, item]));
  const rows: MetadataRow[] = [];
  if (plugins) {
    for (const [name, info] of Object.entries(plugins)) {
      if (!info.metadata_schema) continue;
      const entry = byId.get(name);
      rows.push(entry ? { ...entry, configured: true, stored: entry } : { id: name, value: {}, configured: false });
    }
  }
  for (const entry of stored) {
    if (plugins?.[entry.id]?.metadata_schema) continue;
    const flag = plugins === undefined ? undefined : plugins[entry.id] ? 'noSchema' : 'unknown';
    rows.push({ ...entry, configured: true, stored: entry, ...(flag ? { flag } : {}) });
  }
  return rows.sort(byName);
}

/** The state's words: Configured or Not set. */
export const stateLabel = (item: Item): string => t((item as MetadataRow).configured ? 'pm.state.configured' : 'pm.state.notSet');
