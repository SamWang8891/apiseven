// The SSL editor's Client mTLS tab (field client): whether TLS clients must present a certificate
// signed by a CA, the CA (PEM, with its details), the verification depth and the URIs that skip the
// check. The switch adds an empty `client` (sslIssues then asks for the CA) or removes it with what
// it holds. Subfields are written without pruning (setPathRaw), so clearing one never drops `client`
// and turns the switch off.
import { isObj } from '../../api/sanitize';
import type { Obj } from '../../api/types';
import { setPath, setPathRaw } from '../../editor/draft';
import { issueAt } from '../../editor/issues';
import { t } from '../../i18n';
import { holdsPrivateKey } from '../../schema/secrets';
import { Button, Field, NumberInput, Switch, TagInput, useEditingState, useLocked } from '../../ui';
import { ReadOnlyValue } from '../../ui/ReadOnly';
import type { TabProps } from '../registry';
import { CertDetails } from './CertDetails';
import { certProblem } from './pem';
import { CertBox } from './PemBoxes';
import { typeOf } from './usage';

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/**
 * The CA as typed: emitted when it can be taken (a cleared box removes it); text with no PEM label, or
 * with a private key, holds Save. Locked: its details. A stored CA whose text also holds a private key
 * (stored by another tool) is never put in the box: it says so, with Replace CA for an empty box.
 */
function CaField({ client, write, error }: { client: Obj; write: (ca: string | undefined) => void; error?: string }) {
  const locked = useLocked();
  const keyInside = holdsPrivateKey(client.ca);
  // Editing state: the text being typed (the draft keeps the last text that could be taken), and
  // whether a stored CA that holds a key is being replaced.
  const [text, setText] = useEditingState(keyInside ? '' : (str(client.ca) ?? ''));
  const [replacing, setReplacing] = useEditingState(false);
  const warning = keyInside && (
    <p className="ssl-warn" role="note">
      {t('ssl.cert.holdsKey')}
    </p>
  );
  if (locked || (keyInside && !replacing)) {
    return (
      <div className="ssl-field">
        <span className="ssl-field__label">{t('ssl.client.ca')}</span>
        {warning}
        <CertDetails pem={client.ca} />
        {error && <p className="ssl-issue">{error}</p>}
        {!locked && (
          <span>
            <Button size="sm" onClick={() => setReplacing(true)}>
              {t('ssl.client.replaceCa')}
            </Button>
          </span>
        )}
      </div>
    );
  }
  return (
    <>
      <CertBox
        label={t('ssl.client.ca')}
        help={t('ssl.client.caHelp')}
        value={text}
        error={error}
        onChange={(next) => {
          setText(next);
          if (next.trim() === '') write(undefined);
          else if (certProblem(next) === undefined) write(next);
        }}
      />
      {certProblem(text) === undefined && text.trim() !== '' && <CertDetails pem={text} />}
    </>
  );
}

export function ClientTab({ draft, setDraft, issues }: TabProps) {
  const locked = useLocked();
  const on = draft.client !== undefined;
  const client = isObj(draft.client) ? draft.client : {};
  const set = (key: string, value: unknown) => setDraft(setPathRaw(draft, ['client', key], value));
  return (
    <div className="ed-stack ssl-tab">
      <Switch
        label={t('ssl.client.enable')}
        help={locked ? undefined : t('ssl.client.enableHelp')}
        checked={on}
        onChange={(next) => setDraft(next ? setPathRaw(draft, ['client'], {}) : setPath(draft, ['client'], undefined))}
      />
      {typeOf(draft) === 'client' && <p className="ed-note">{t('ssl.client.clientNote')}</p>}
      {issueAt(issues, 'client') && <p className="ssl-issue">{issueAt(issues, 'client')}</p>}
      {on && (
        <div className="ed-grid">
          <div className="ed-wide">
            <CaField client={client} write={(ca) => set('ca', ca)} error={issueAt(issues, 'client.ca')} />
          </div>
          {locked && client.depth === undefined ? (
            <Field label={t('ssl.client.depth')}>
              <ReadOnlyValue>{t('ssl.client.depthDefault')}</ReadOnlyValue>
            </Field>
          ) : (
            <NumberInput
              label={t('ssl.client.depth')}
              help={locked ? undefined : t('ssl.client.depthHelp')}
              integer
              min={0}
              placeholder="1"
              value={typeof client.depth === 'number' ? client.depth : undefined}
              error={issueAt(issues, 'client.depth')}
              onChange={(v) => set('depth', v)}
            />
          )}
          <div className="ed-wide">
            <TagInput
              label={t('ssl.client.skip')}
              fieldName={t('ssl.client.skip')}
              help={locked ? undefined : t('ssl.client.skipHelp')}
              mono
              value={strings(client.skip_mtls_uri_regex)}
              error={issueAt(issues, 'client.skip_mtls_uri_regex')}
              onChange={(next) => set('skip_mtls_uri_regex', next.length > 0 ? next : undefined)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
