// The SSL editor's General tab (fields type, desc, labels, ssl_protocols): server or client, the
// description and labels, and the TLS versions it accepts (none checked: APISIX's own setting). The
// status is the header's switch; for a client certificate this tab says why there is none.
import { setPath } from '../../editor/draft';
import { issueAt } from '../../editor/issues';
import { t } from '../../i18n';
import { Checkbox, Field, Segmented, useLocked } from '../../ui';
import { ReadOnlyValue } from '../../ui/ReadOnly';
import { MetaFields } from '../MetaFields';
import type { TabProps } from '../registry';
import { typeOf } from './usage';
import { SSL_PROTOCOLS } from './validate';

export function GeneralTab({ draft, setDraft, issues }: TabProps) {
  const locked = useLocked();
  const type = typeOf(draft);
  const stored: unknown[] = Array.isArray(draft.ssl_protocols) ? draft.ssl_protocols : [];
  // A value the boxes don't offer is kept as it is (APISIX refuses it; the JSON tab shows it).
  const others = stored.filter((p) => !(SSL_PROTOCOLS as readonly unknown[]).includes(p));
  const toggle = (protocol: string, on: boolean) => {
    const next = [...SSL_PROTOCOLS.filter((p) => (p === protocol ? on : stored.includes(p))), ...others];
    setDraft(setPath(draft, ['ssl_protocols'], next));
  };
  return (
    <div className="ed-grid">
      <div className="ed-wide">
        <Segmented
          label={t('ssl.general.type')}
          help={locked ? undefined : t('ssl.general.typeHelp')}
          error={issueAt(issues, 'type')}
          value={type}
          options={[
            { value: 'server', label: t('ssl.type.server') },
            { value: 'client', label: t('ssl.type.client') },
          ]}
          onChange={(value) => setDraft(setPath(draft, ['type'], value))}
        />
        {type === 'client' && <p className="ed-note">{t('ssl.status.ignored')}</p>}
      </div>
      <MetaFields
        draft={draft}
        setDraft={setDraft}
        issues={issues}
        labels={{ desc: t('ssl.general.desc'), labels: t('ssl.general.labels'), labelsHelp: t('ssl.general.labelsHelp') }}
      />
      <div className="ed-wide">
        <Field label={t('ssl.general.protocols')} help={locked ? undefined : t('ssl.general.protocolsHelp')} error={issueAt(issues, 'ssl_protocols')}>
          {locked && stored.length === 0 ? (
            <ReadOnlyValue>{t('ssl.general.protocolsDefault')}</ReadOnlyValue>
          ) : (
            <span className="ssl-protocols" role="group" aria-label={t('ssl.general.protocols')}>
              {SSL_PROTOCOLS.map((protocol) => (
                <Checkbox key={protocol} checked={stored.includes(protocol)} onChange={(on) => toggle(protocol, on)}>
                  {protocol}
                </Checkbox>
              ))}
            </span>
          )}
        </Field>
      </div>
    </div>
  );
}
