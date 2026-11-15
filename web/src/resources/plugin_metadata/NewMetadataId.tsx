// A new plugin metadata entry's id, above the tabs (ResourceDef.NewId): the plugin it is for, picked
// from the plugins with metadata settings that have none stored yet. While either list loads, the
// picker says so; when the plugin list can't load, the name is typed; when the stored entries can't
// load, every plugin with metadata settings is offered, and the page says why. Switching from one plugin to
// another clears the settings entered for the first (they are another plugin's), after asking when
// there are any. Create still checks that nothing was stored meanwhile (editor/save.ts holderOf).
import { useState } from 'react';
import { useAllPlugins, useList } from '../../api/hooks';
import { t } from '../../i18n';
import { ConfirmDialog, Input, Select } from '../../ui';
import type { NewIdProps } from '../registry';
import '../resources.css';

export function NewMetadataId({ value, onChange, draft, setDraft, error, inputRef }: NewIdProps) {
  const plugins = useAllPlugins();
  const stored = useList('plugin_metadata');
  /** View state: a switch of plugin waiting for the user's yes. */
  const [asking, setAsking] = useState<string>();
  const switchTo = (next: string) => {
    setAsking(undefined);
    onChange(next);
    setDraft({});
  };
  const choose = (next: string | undefined) => {
    if (next === undefined || next === value) return;
    if (value === '') onChange(next);
    else if (Object.keys(draft).some((key) => key !== 'id')) setAsking(next);
    else switchTo(next);
  };

  if (plugins.isError) {
    return (
      <Input
        ref={inputRef}
        label={t('pm.newId.label')}
        required
        mono
        value={value}
        onChange={(e) => onChange(e.target.value)}
        help={t('pm.newId.failedHelp')}
        error={error}
      />
    );
  }

  const loading = !plugins.data || (!stored.data && !stored.isError);
  const taken = new Set((stored.data ?? []).map((item) => item.id));
  const names = Object.entries(plugins.data ?? {})
    .filter(([name, info]) => info.metadata_schema !== undefined && (!taken.has(name) || name === value))
    .map(([name]) => name)
    .sort();
  return (
    <>
      <Select
        label={t('pm.newId.label')}
        required
        mono
        searchable
        disabled={loading}
        value={value === '' ? undefined : value}
        onChange={choose}
        placeholder={loading ? t('pm.newId.loading') : t('pm.newId.placeholder')}
        options={names.map((name) => ({ value: name, label: name }))}
        help={stored.isError ? t('pm.newId.storedFailed', { error: stored.error.message }) : !loading && names.length === 0 ? t('pm.newId.none') : t('pm.newId.help')}
        error={error}
      />
      {asking !== undefined && (
        <ConfirmDialog
          open
          title={t('editor.switchId.title', { to: asking })}
          body={<p>{t('editor.switchId.body', { from: value, to: asking })}</p>}
          confirmLabel={t('editor.switchId.confirm')}
          onConfirm={() => switchTo(asking)}
          onCancel={() => setAsking(undefined)}
        />
      )}
    </>
  );
}
