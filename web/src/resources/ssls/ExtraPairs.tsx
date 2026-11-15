// The Certificate tab's additional pairs (`certs` / `keys`): each certificate's details in short and
// where its key stands (extraPairs.ts), Remove, "Enter key" where one is needed, and "Add certificate
// pair" through the same dialog as Replace. Rows carry no text inputs; they are keyed by row ids that
// follow them through add and remove all the same.
import { Trash2 } from 'lucide-react';
import type { Item, Obj } from '../../api/types';
import { issueAt, issuesUnder, type Issue } from '../../editor/issues';
import { t } from '../../i18n';
import { Button, useEditingState, useLocked } from '../../ui';
import { freshIds, useRowIds, withoutId } from '../../upstream/rowIds';
import { ExpiryBadge } from '../expiry';
import { Section } from '../Section';
import { keyStates, withKeyEntered, withPairAdded, withPairRemoved, type KeyState } from './pairKeys';
import { parseCert } from './parseCert';
import { ReplaceCertDialog } from './ReplaceCertDialog';
import { isSecretRef } from './validate';

/** One line about a certificate: its subject and names, and its expiry; a reference or an unreadable one says so. */
function CertLine({ pem }: { pem: unknown }) {
  if (typeof pem !== 'string') return <span className="ssl-warn">{t('ssl.cert.unreadable')}</span>;
  if (isSecretRef(pem.trim())) return <span className="mono ssl-wrap">{pem.trim()}</span>;
  const info = parseCert(pem);
  if (!info) return <span className="ssl-warn">{t('ssl.cert.unreadable')}</span>;
  return (
    <span className="ssl-pair__cert">
      <span>{info.subject}</span>
      {info.sans.length > 0 && <span className="mono ssl-muted ssl-wrap">{info.sans.join(', ')}</span>}
      <ExpiryBadge notAfter={info.notAfter} />
    </span>
  );
}

const TONE: Record<KeyState, string> = { stored: 'ssl-pair__key', entered: 'ssl-pair__key', needed: 'ssl-pair__key ssl-pair__key--needed', stale: 'ssl-pair__key ssl-pair__key--needed' };

export interface ExtraPairsProps {
  draft: Obj;
  setDraft: (next: Obj) => void;
  isNew: boolean;
  original?: Item;
  issues: Issue[];
  /** A client certificate: APISIX presents no extra pair for it (only a server one is presented). */
  client: boolean;
}

type Opened = { mode: 'add' } | { mode: 'key'; index: number };

export function ExtraPairs({ draft, setDraft, isNew, original, issues, client }: ExtraPairsProps) {
  const locked = useLocked();
  const certs: unknown[] = Array.isArray(draft.certs) ? draft.certs : [];
  const states = keyStates(draft, isNew, original?.value);
  const [ids, setIds] = useRowIds(certs.length);
  // Editing state: which dialog is open ends with the editing session.
  const [opened, setOpened] = useEditingState<Opened | undefined>(undefined);
  const problems = [...issuesUnder(issues, 'certs'), ...issuesUnder(issues, 'keys')];
  const whole = issueAt(issues, 'keys') ?? issueAt(issues, 'certs');

  return (
    <>
      <Section
      title={t('ssl.extra.title')}
      summary={certs.length > 0 ? t('ssl.extra.summary', { count: certs.length }) : t('ssl.extra.none')}
      issues={problems.length}
      defaultOpen={certs.length > 0}
    >
      <div className="ssl-pairs">
        <p className="ed-note">{client ? t('ssl.extra.clientNote') : t('ssl.extra.help')}</p>
        {whole && (
          <p className="ssl-issue" role="alert">
            {whole}
          </p>
        )}
        {certs.length === 0 && locked && <p className="ed-note">{t('ssl.extra.none')}</p>}
        {certs.length > 0 && (
          <ol className="ssl-pairs__list">
            {certs.map((cert, i) => {
              const state = states[i] ?? 'needed';
              const problem = issueAt(issues, `keys.${i}`) ?? issueAt(issues, `certs.${i}`);
              return (
                <li key={ids[i]} className="ssl-pair" aria-label={t('ssl.extra.row', { n: i + 1 })}>
                  <CertLine pem={cert} />
                  <span className={TONE[state]}>{t(`ssl.extra.${state}`)}</span>
                  {problem && problem !== whole && <span className="ssl-issue">{problem}</span>}
                  {!locked && (
                    <span className="ssl-pair__tools">
                      {(state === 'needed' || state === 'stale') && (
                        <Button size="sm" aria-label={t('ssl.extra.enterKeyFor', { n: i + 1 })} onClick={() => setOpened({ mode: 'key', index: i })}>
                          {t('ssl.extra.enterKey')}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Trash2 size={13} />}
                        aria-label={t('ssl.extra.remove', { n: i + 1 })}
                        onClick={() => {
                          setIds(withoutId(ids, i));
                          setDraft(withPairRemoved(draft, i, isNew, original?.value));
                        }}
                      />
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        {!locked && (
          <span>
            <Button size="sm" onClick={() => setOpened({ mode: 'add' })}>
              {t('ssl.extra.add')}
            </Button>
          </span>
        )}
      </div>
      </Section>
      {opened && !locked && (
        <ReplaceCertDialog
          mode={opened.mode}
          current={opened.mode === 'key' && typeof certs[opened.index] === 'string' ? (certs[opened.index] as string) : undefined}
          onClose={() => setOpened(undefined)}
          onApply={({ cert, key }) => {
            if (opened.mode === 'key') return setDraft(withKeyEntered(draft, opened.index, key));
            setIds([...ids, ...freshIds(1)]);
            setDraft(withPairAdded(draft, cert, key));
          }}
        />
      )}
    </>
  );
}
