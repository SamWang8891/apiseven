// What a schema's checks leave to APISIX (schema/prepare.ts SchemaGaps), as one quiet line: under a
// plugin card's JSON view, and above the plugin metadata and secret manager forms, whose checks run
// through the same compile path. Nothing when the browser reads the whole schema.
import type { Obj } from '../api/types';
import { t } from '../i18n';
import { schemaGaps } from '../schema/ajv';

export function SchemaGapsNote({ schema, className }: { schema: Obj; className: string }) {
  const gaps = schemaGaps(schema);
  if (!gaps) return null;
  const text = gaps === 'all' ? t('sf.gaps.all') : t('sf.gaps.some', { parts: gaps.map((gap) => t(`sf.gaps.${gap}`)).join('; ') });
  return <p className={className}>{text}</p>;
}
