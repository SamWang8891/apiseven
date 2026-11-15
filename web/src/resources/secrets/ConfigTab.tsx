// A secret's Settings tab: its manager (a badge; a new secret picks it above the tabs), a form over
// that manager's schema (schemas.ts) bound to the draft without its id, the credentials masked until
// revealed (SECRET_FIELDS; the kit hides them again on every lock change), and how plugins refer to it.
import { Copy } from 'lucide-react';
import { t } from '../../i18n';
import { SchemaForm } from '../../schema-form/SchemaForm';
import { Badge, Button, toast } from '../../ui';
import type { TabProps } from '../registry';
import { withId, withoutId } from '../withoutId';
import { managerOf, SCHEMAS, SECRET_FIELDS, splitSecretId, type Manager } from './schemas';
import '../resources.css';

async function copy(text: string) {
  try {
    if (!navigator.clipboard) throw new Error('clipboard unavailable');
    await navigator.clipboard.writeText(text);
    toast.success(t('sc.ref.copied', { prefix: text }));
  } catch (err) {
    toast.error(t('cell.copyFailed', { error: err instanceof Error ? err.message : String(err) }));
  }
}

/**
 * How a plugin field names a value from this manager: secret.lua parse_secret_uri (107–138) splits
 * "$secret://<manager>/<id>/<key>"; each manager reads <key> its own way (vault.lua 86–117: a path
 * and the field after its last slash; aws.lua 113–160 and gcp.lua 176–200: a secret, then optionally
 * a field of its JSON). Where references work: docs/en/latest/terminology/secret.md 47–53.
 */
function Reference({ manager, name }: { manager: Manager; name: string }) {
  const prefix = `$secret://${manager}/${name}/`;
  return (
    <section className="res-ref" aria-label={t('sc.ref.title')}>
      <h3 className="res-ref__title">{t('sc.ref.title')}</h3>
      {name === '' ? (
        <p className="res-ref__text">{t('sc.ref.newNote')}</p>
      ) : (
        <>
          <div className="res-ref__line">
            <code className="res-ref__code mono">{prefix}</code>
            <Button size="sm" variant="ghost" icon={<Copy size={13} />} onClick={() => void copy(prefix)}>
              {t('sc.ref.copy')}
            </Button>
          </div>
          <p className="res-ref__text">{t(`sc.ref.${manager}`, { prefix })}</p>
        </>
      )}
      <p className="res-ref__text">{t('sc.ref.where')}</p>
    </section>
  );
}

export function ConfigTab({ draft, setDraft, issues, id, isNew }: TabProps) {
  const manager = managerOf(id);
  const { manager: named, name } = splitSecretId(id);
  if (!manager) return <p className="res-callout">{named === '' ? t('sc.config.choose') : t('sc.config.unknown', { manager: named })}</p>;
  return (
    <div className="ed-stack">
      {!isNew && (
        <p className="res-badges">
          <Badge tone="accent">{t(`sc.manager.${manager}`)}</Badge>
        </p>
      )}
      <SchemaForm
        schema={SCHEMAS[manager]}
        value={withoutId(draft)}
        onChange={(next) => setDraft(withId(draft, next))}
        encryptFields={SECRET_FIELDS[manager]}
        errors={issues}
        idPrefix={`secret-${manager}`}
        name={manager}
      />
      <Reference manager={manager} name={name} />
    </div>
  );
}
