// TLS towards the nodes: whether to verify their certificate, which CA certificates to trust, and
// the client certificate APISIX presents (mTLS): none, a PEM pair pasted or uploaded here, or a
// stored SSL object of type client. Choosing one removes the other's fields, as APISIX allows only
// one of them. For a stream upstream only the client certificate applies (set_stream_upstream_
// client_cert, apisix/upstream.lua 284–326; verify and ca_certs are read by set_upstream_ssl_opts
// on the http path only): verification and CA certificates show only when stored, with a note.
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import type { Obj } from '../api/types';
import { removeAt, setPath, setPathRaw } from '../editor/draft';
import { issueAt } from '../editor/issues';
import { t } from '../i18n';
import { ResourcePicker } from '../resources/ResourcePicker';
import { Button, Field, Segmented, useLocked } from '../ui';
import { ReadOnlyValue } from '../ui/ReadOnly';
import { ChoiceSelect, PemField, StreamNote } from './fields';
import { useRowIds, withoutId } from './rowIds';
import { obj, str, type SectionProps } from './values';

type Mode = 'none' | 'inline' | 'ssl';
const INLINE = ['client_cert', 'client_key'];

function modeOf(tls: Obj): Mode | undefined {
  if (tls.client_cert_id !== undefined) return 'ssl';
  if (tls.client_cert !== undefined || tls.client_key !== undefined) return 'inline';
  return undefined;
}

export function TlsSection({ value, onChange, issues, ctx, subsystem, stored }: SectionProps) {
  const locked = useLocked();
  const tls = obj(value.tls);
  const [chosen, setChosen] = useState<Mode>();
  const mode = modeOf(tls) ?? chosen ?? 'none';
  const issue = (path: string) => issueAt(issues, `tls.${path}`);
  const set = (path: (string | number)[], v: unknown) => onChange(setPath(value, ['tls', ...path], v));
  const verify = tls.verify === true ? 'true' : tls.verify === false ? 'false' : undefined;
  const certId = typeof tls.client_cert_id === 'number' ? String(tls.client_cert_id) : str(tls.client_cert_id);
  const cas: unknown[] = Array.isArray(tls.ca_certs) ? tls.ca_certs : [];
  // One id per CA row, following it through removals (an added row gets a new one at the end).
  const [caIds, setCaIds] = useRowIds(cas.length);
  const stream = subsystem === 'stream';
  const showVerify = !stream || tls.verify !== undefined;
  const showCas = !stream || tls.ca_certs !== undefined;

  function switchTo(next: string) {
    if (next === mode) return;
    setChosen(next as Mode);
    const drop = next === 'none' ? [...INLINE, 'client_cert_id'] : next === 'inline' ? ['client_cert_id'] : INLINE;
    onChange(drop.reduce((up, key) => setPath(up, ['tls', key], undefined), value));
  }

  return (
    <div className="ed-stack">
      {showVerify && (
        <div className="ed-grid">
          {/* `verify` unset means the gateway's own setting, so it is a three-way choice. */}
          <div className="up-noted">
            <ChoiceSelect
              label={t('up.tls.verify')}
              value={verify}
              defaultLabel={t('up.tls.verifyDefault')}
              choices={[
                { value: 'true', label: t('up.tls.verifyOn') },
                { value: 'false', label: t('up.tls.verifyOff') },
              ]}
              error={issue('verify')}
              onChange={(v) => set(['verify'], v === undefined ? undefined : v === 'true')}
            />
            {stream && <StreamNote />}
          </div>
        </div>
      )}

      <Segmented
        label={t('up.tls.mode')}
        value={mode}
        onChange={switchTo}
        options={[
          { value: 'none', label: t('up.tls.mode.none') },
          { value: 'inline', label: t('up.tls.mode.inline') },
          { value: 'ssl', label: t('up.tls.mode.ssl') },
        ]}
      />
      {mode === 'inline' && (
        <div className="ed-grid up-indent">
          <PemField label={t('up.tls.cert')} value={str(tls.client_cert)} error={issue('client_cert')} onChange={(v) => set(['client_cert'], v)} />
          <PemField
            label={t('up.tls.key')}
            secret
            value={str(tls.client_key)}
            stored={str(obj(stored?.tls).client_key)}
            error={issue('client_key')}
            onChange={(v) => set(['client_key'], v)}
          />
        </div>
      )}
      {mode === 'ssl' && (
        <div className="ed-grid up-indent">
          <ResourcePicker
            kind="ssls"
            items={ctx.ssls}
            loading={!ctx.loaded.ssls}
            filter={(item) => item.value.type === 'client'}
            label={t('up.tls.ssl')}
            help={locked ? undefined : t('up.tls.sslHelp')}
            value={certId}
            error={issue('client_cert_id')}
            onChange={(id) => set(['client_cert_id'], id)}
          />
        </div>
      )}

      {showCas && (
        <Field
          label={t('up.tls.ca')}
          help={locked ? undefined : t('up.tls.caHelp')}
          error={issue('ca_certs')}
          action={
            locked ? undefined : (
              <Button variant="ghost" size="sm" icon={<Plus size={13} />} onClick={() => onChange(setPathRaw(value, ['tls', 'ca_certs'], [...cas, '']))}>
                {t('up.tls.addCa')}
              </Button>
            )
          }
        >
          {cas.length === 0 ? (
            locked && <ReadOnlyValue>{t('up.default', { value: t('up.tls.caDefault') })}</ReadOnlyValue>
          ) : (
            <div className="up-cas">
              {cas.map((pem, i) => (
                <PemField
                  key={caIds[i] ?? i}
                  label={t('up.tls.caN', { n: i + 1 })}
                  value={str(pem)}
                  error={issue(`ca_certs.${i}`)}
                  // An emptied entry stays (as '') until removed, so the list keeps its rows.
                  onChange={(v) => onChange(setPathRaw(value, ['tls', 'ca_certs', i], v ?? ''))}
                  extra={
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<X size={14} />}
                      aria-label={t('up.tls.removeCa', { n: i + 1 })}
                      onClick={() => {
                        setCaIds((prev) => withoutId(prev, i));
                        onChange(removeAt(value, ['tls', 'ca_certs'], i));
                      }}
                    />
                  }
                />
              ))}
            </div>
          )}
          {stream && <StreamNote />}
        </Field>
      )}
    </div>
  );
}

