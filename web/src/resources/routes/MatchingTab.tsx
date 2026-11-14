// The route editor's Matching tab: which requests the route takes. Hosts, URIs and client addresses
// are tag lists (one value is written as host / uri / remote_addr, several as the plural key; see
// pairs.ts), methods a row of boxes (none ticked: any method), conditions the VarsBuilder, and the
// rarely used filter function a Lua editor in a collapsed section.
import { useId } from 'react';
import type { Obj } from '../../api/types';
import { setPath } from '../../editor/draft';
import { issueAt, issuesUnder, type Issue } from '../../editor/issues';
import { t } from '../../i18n';
import { Badge, Button, Checkbox, CodeEditor, Field, TagInput, useLocked } from '../../ui';
import type { TabProps } from '../registry';
import { routeHosts } from '../resolve';
import { Section } from '../Section';
import { readPair, writePair } from './pairs';
import { addrProblem, hostProblem, METHODS, uriProblem } from './validate';
import { VarsBuilder } from './VarsBuilder';
import './routes.css';

/** The first issue about either key of a pair (`host`, `hosts.1`, …). */
const pairIssue = (issues: Issue[], single: string, plural: string): string | undefined =>
  [...issuesUnder(issues, single), ...issuesUnder(issues, plural)][0]?.message;

/** A locked list of values as mono chips, or what an empty list means. */
function LockedList({ label, values, empty, note }: { label: string; values: string[]; empty: string; note?: string }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="rt-list">
      <Field label={<span id={id}>{label}</span>}>
        <span className="ro-value ro-value--chips">
          {values.length === 0 ? (
            <span className="rt-list__empty">{empty}</span>
          ) : (
            values.map((v, i) => (
              <span key={`${i}:${v}`} className="ui-chip mono">
                {v}
              </span>
            ))
          )}
        </span>
        {note && <span className="rt-list__note">{note}</span>}
      </Field>
    </div>
  );
}

function PairField(p: { draft: Obj; setDraft: (d: Obj) => void; issues: Issue[]; single: string; plural: string; label: string; help: string; empty: string; required?: boolean; problem: (v: string) => string | undefined; note?: { values: string[]; text: string } }) {
  const locked = useLocked();
  const values = readPair(p.draft, p.single, p.plural);
  const error = pairIssue(p.issues, p.single, p.plural);
  if (locked && values.length === 0) {
    return <LockedList label={p.label} values={p.note?.values ?? []} empty={p.empty} note={p.note && p.note.values.length > 0 ? p.note.text : undefined} />;
  }
  if (locked) return <LockedList label={p.label} values={values} empty={p.empty} />;
  return (
    <TagInput
      label={p.label}
      mono
      required={p.required}
      help={p.help}
      error={error}
      value={values}
      validate={p.problem}
      onChange={(next) => p.setDraft(writePair(p.draft, p.single, p.plural, next))}
    />
  );
}

/** One box per method the schema allows; none ticked writes no `methods` (any method). */
function Methods({ draft, setDraft, error }: { draft: Obj; setDraft: (d: Obj) => void; error?: string }) {
  const locked = useLocked();
  const id = useId();
  const chosen = new Set(Array.isArray(draft.methods) ? draft.methods.filter((m): m is string => typeof m === 'string') : []);
  // Methods the schema doesn't know (only possible through the JSON) are kept, after the known ones.
  const unknown = [...chosen].filter((m) => !(METHODS as readonly string[]).includes(m));
  const write = (next: string[]) => setDraft(setPath(draft, ['methods'], next.length > 0 ? [...next, ...unknown] : undefined));
  const any = chosen.size === 0;
  const label = <span id={id}>{t('rt.match.methods')}</span>;

  if (locked) {
    return (
      <div role="group" aria-labelledby={id} className="rt-list">
        <Field label={label} error={error}>
          <span className="ro-value ro-value--chips">
            {any ? (
              <span className="rt-list__empty">{t('rt.match.anyMethod')}</span>
            ) : (
              [...chosen].map((m) => (
                <span key={m} className="ui-chip mono">
                  {m}
                </span>
              ))
            )}
          </span>
        </Field>
      </div>
    );
  }

  return (
    <div role="group" aria-labelledby={id} className="rt-methods">
      <Field label={label} error={error} help={t('rt.match.methodsHelp')}>
        <div className="rt-methods__row">
          {METHODS.map((m) => (
            <Checkbox key={m} checked={chosen.has(m)} onChange={(on) => write(METHODS.filter((x) => (x === m ? on : chosen.has(x))))}>
              <span className="mono">{m}</span>
            </Checkbox>
          ))}
          <span className="rt-methods__shortcuts">
            <Button variant="ghost" size="sm" onClick={() => write([...METHODS])}>
              {t('rt.match.all')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => write([])}>
              {t('rt.match.none')}
            </Button>
          </span>
          {any && <Badge tone="accent">{t('rt.match.anyMethod')}</Badge>}
        </div>
      </Field>
    </div>
  );
}

export function MatchingTab({ draft, setDraft, issues, ctx }: TabProps) {
  const locked = useLocked();
  const inherited = routeHosts({ service_id: draft.service_id }, ctx);
  const service = ctx.services.find((s) => String(s.id) === String(draft.service_id));
  const filter = typeof draft.filter_func === 'string' ? draft.filter_func : '';
  const filterIssues = issuesUnder(issues, 'filter_func');
  return (
    <div className="ed-stack">
      <div className="ed-grid">
        <PairField
          draft={draft}
          setDraft={setDraft}
          issues={issues}
          single="host"
          plural="hosts"
          label={t('rt.match.hosts')}
          help={t('rt.match.hostsHelp')}
          empty={t('rt.match.anyHost')}
          problem={hostProblem}
          note={{ values: inherited.hosts, text: t('rt.match.fromService', { name: service ? (typeof service.value.name === 'string' ? service.value.name : service.id) : '' }) }}
        />
        <PairField
          draft={draft}
          setDraft={setDraft}
          issues={issues}
          single="uri"
          plural="uris"
          label={t('rt.match.uris')}
          help={t('rt.match.urisHelp')}
          empty={t('ui.empty')}
          required
          problem={uriProblem}
        />
        <div className="ed-wide">
          <Methods draft={draft} setDraft={setDraft} error={issueAt(issues, 'methods')} />
        </div>
        <PairField
          draft={draft}
          setDraft={setDraft}
          issues={issues}
          single="remote_addr"
          plural="remote_addrs"
          label={t('rt.match.addrs')}
          help={t('rt.match.addrsHelp')}
          empty={t('rt.match.anyAddr')}
          problem={addrProblem}
        />
      </div>
      <div className="rt-wide">
        <VarsBuilder value={draft.vars} error={issueAt(issues, 'vars')} onChange={(v) => setDraft(setPath(draft, ['vars'], v))} />
      </div>
      {(!locked || filter !== '') && (
        <div className="rt-wide">
          <Section title={t('rt.match.filter')} summary={filter === '' ? t('rt.match.filterNone') : t('rt.match.filterSet')} issues={filterIssues.length}>
            <Field label={t('rt.match.filterLabel')} help={locked ? undefined : t('rt.match.filterHelp')} error={filterIssues[0]?.message}>
              <CodeEditor
                language="lua"
                aria-label={t('rt.match.filterLabel')}
                aria-invalid={filterIssues.length > 0 || undefined}
                minLines={3}
                maxLines={16}
                value={filter}
                onChange={(v) => setDraft(setPath(draft, ['filter_func'], v))}
              />
            </Field>
          </Section>
        </div>
      )}
    </div>
  );
}
