// The stream route editor's Matching tab: which connections the route takes. Every field is
// optional and all that are set must match (match_addrs in apisix/stream/router/ip_port.lua): the
// address and port APISIX accepted the connection on, the client's address, and the TLS server
// names (one is written as `sni`, several as `snis`; routes with SNIs are tried first). An address is
// written as typed and flagged at once when APISIX would refuse it (streamAddressProblem).
import type { Obj } from '../../api/types';
import { setPath } from '../../editor/draft';
import { issueAt, issuesUnder, type Issue } from '../../editor/issues';
import { t } from '../../i18n';
import { Field, Input, NumberInput, TagInput, useLocked } from '../../ui';
import { ReadOnlyValue } from '../../ui/ReadOnly';
import type { TabProps } from '../registry';
import { readPair, writePair } from '../routes/pairs';
import { hostProblem } from '../routes/validate';

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** An unset field, locked: what leaving it unset means. */
function Unset({ label, meaning, error }: { label: string; meaning: string; error?: string }) {
  return (
    <Field label={label} error={error}>
      <ReadOnlyValue>{meaning}</ReadOnlyValue>
    </Field>
  );
}

function Address({ draft, setDraft, issues, field, label, help, unset }: { draft: Obj; setDraft: (d: Obj) => void; issues: Issue[]; field: string; label: string; help: string; unset: string }) {
  const locked = useLocked();
  const error = issueAt(issues, field);
  if (locked && draft[field] === undefined) return <Unset label={label} meaning={unset} error={error} />;
  return (
    <Input
      label={label}
      mono
      value={typeof draft[field] === 'string' ? text(draft[field]) : draft[field] === undefined ? '' : JSON.stringify(draft[field])}
      help={locked ? undefined : help}
      error={error}
      onChange={(e) => setDraft(setPath(draft, [field], e.target.value))}
    />
  );
}

export function MatchingTab({ draft, setDraft, issues }: TabProps) {
  const locked = useLocked();
  const snis = readPair(draft, 'sni', 'snis');
  const sniError = [...issuesUnder(issues, 'sni'), ...issuesUnder(issues, 'snis')][0]?.message;
  const port = typeof draft.server_port === 'number' ? draft.server_port : undefined;
  return (
    <div className="ed-stack">
      {!locked && <p className="ed-note">{t('sr.match.help')}</p>}
      <div className="ed-grid">
        <Address
          draft={draft}
          setDraft={setDraft}
          issues={issues}
          field="server_addr"
          label={t('sr.match.serverAddr')}
          help={t('sr.match.serverAddrHelp')}
          unset={t('sr.match.anyServerAddr')}
        />
        {locked && draft.server_port === undefined ? (
          <Unset label={t('sr.match.serverPort')} meaning={t('sr.match.anyPort')} error={issueAt(issues, 'server_port')} />
        ) : (
          <NumberInput
            label={t('sr.match.serverPort')}
            integer
            mono
            min={1}
            max={65535}
            value={port}
            help={locked ? undefined : t('sr.match.serverPortHelp')}
            error={issueAt(issues, 'server_port')}
            onChange={(v) => setDraft(setPath(draft, ['server_port'], v))}
          />
        )}
        <Address
          draft={draft}
          setDraft={setDraft}
          issues={issues}
          field="remote_addr"
          label={t('sr.match.remoteAddr')}
          help={t('sr.match.remoteAddrHelp')}
          unset={t('sr.match.anyClient')}
        />
        {locked && snis.length === 0 ? (
          <Unset label={t('sr.match.snis')} meaning={t('sr.match.anySni')} error={sniError} />
        ) : (
          <TagInput
            label={t('sr.match.snis')}
            mono
            help={locked ? undefined : t('sr.match.snisHelp')}
            error={sniError}
            value={snis}
            validate={hostProblem}
            onChange={(next) => setDraft(writePair(draft, 'sni', 'snis', next))}
          />
        )}
      </div>
    </div>
  );
}
