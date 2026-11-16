// A plugin metadata entry's Settings tab: a form over its plugin's metadata schema (from the plugin
// list: GET /plugins?all=true), bound to the draft without its id. A plugin the list doesn't have, or
// one that declares no metadata schema, is edited on the JSON tab; so is every entry while the list
// can't load. Secret fields (the schema's encrypt_fields) are masked by the form.
import { useMemo } from 'react';
import { useAllPlugins } from '../../api/hooks';
import { t } from '../../i18n';
import { SchemaForm } from '../../schema-form/SchemaForm';
import { SchemaGapsNote } from '../../schema-form/SchemaGapsNote';
import type { TabProps } from '../registry';
import { withId, withoutId } from '../withoutId';
import '../resources.css';

export function ConfigTab({ draft, setDraft, issues, id, isNew, original }: TabProps) {
  const plugins = useAllPlugins();
  // One object per stored value: the form shares it with every field (item 132: not one per render).
  const baseline = useMemo(() => original && withoutId(original.value), [original]);
  if (id === undefined || id === '') return <p className="res-callout">{t('pm.config.choose')}</p>;
  if (plugins.isError) return <p className="res-callout">{t('pm.config.failed', { error: plugins.error.message })}</p>;
  if (!plugins.data) return <p className="res-note">{t('pm.config.loading')}</p>;
  const info = plugins.data[id];
  if (!info) return <p className="res-callout">{t('pm.config.unknown', { name: id })}</p>;
  const schema = info.metadata_schema;
  if (!schema) return <p className="res-callout">{t('pm.config.noSchema', { name: id })}</p>;
  return (
    <div className="ed-stack">
      <p className="res-note">{isNew ? t('pm.config.notSet', { name: id }) : t('pm.config.help', { name: id })}</p>
      <SchemaGapsNote schema={schema} className="res-note" />
      {/* One form per plugin: a switch to another (a new entry's picker) discards what this one's fields hold (final wave N2). */}
      <SchemaForm
        key={id}
        schema={schema}
        value={withoutId(draft)}
        onChange={(next) => setDraft(withId(draft, next))}
        errors={issues}
        idPrefix={`meta-${id}`}
        name={id}
        baseline={baseline}
      />
    </div>
  );
}
