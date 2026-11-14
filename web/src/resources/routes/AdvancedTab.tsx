// The route editor's Advanced tab: the route's own timeouts (APISIX takes all three or none: filling
// one fills the others with nginx's 60s, clearing all three removes them), WebSocket (unset follows
// the service, else off: apisix/init.lua), and the script, which runs instead of every plugin.
import { isObj } from '../../api/sanitize';
import { setPath } from '../../editor/draft';
import { issueAt, issuesUnder } from '../../editor/issues';
import { t } from '../../i18n';
import { CodeEditor, Field, Input, NumberInput, Segmented, useLocked } from '../../ui';
import { ReadOnlyValue } from '../../ui/ReadOnly';
import type { TabProps } from '../registry';
import { Section } from '../Section';
import './routes.css';

const TIMEOUTS = ['connect', 'send', 'read'] as const;
/** nginx's proxy_*_timeout default, which APISIX keeps when no timeout is set anywhere. */
const NGINX_TIMEOUT = 60;

const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

export function AdvancedTab({ draft, setDraft, issues }: TabProps) {
  const locked = useLocked();
  const timeout = isObj(draft.timeout) ? draft.timeout : undefined;
  const hasService = draft.service_id !== undefined;
  const script = typeof draft.script === 'string' ? draft.script : '';
  const scriptIssues = issuesUnder(issues, 'script');

  function setTimeoutField(key: (typeof TIMEOUTS)[number], v: number | undefined) {
    if (v === undefined) {
      setDraft(setPath(draft, ['timeout', key], undefined));
      return;
    }
    const filled = Object.fromEntries(TIMEOUTS.map((k) => [k, timeout?.[k] ?? NGINX_TIMEOUT]));
    setDraft(setPath(draft, ['timeout'], { ...timeout, ...filled, [key]: v }));
  }

  const ws = draft.enable_websocket === true ? 'on' : draft.enable_websocket === false ? 'off' : 'default';

  return (
    <div className="ed-stack">
      {locked && !timeout ? (
        <div className="ed-grid">
          <Field label={t('rt.adv.timeouts')}>
            <ReadOnlyValue>{t('rt.adv.timeoutsUnset')}</ReadOnlyValue>
          </Field>
        </div>
      ) : (
        <fieldset className="rt-group">
          <legend className="rt-group__title">{t('rt.adv.timeouts')}</legend>
          <div className="rt-group__three">
            {TIMEOUTS.map((key) => (
              <NumberInput
                key={key}
                label={t(`rt.adv.${key}`)}
                min={0}
                value={num(timeout?.[key])}
                error={issueAt(issues, `timeout.${key}`)}
                onChange={(v) => setTimeoutField(key, v)}
              />
            ))}
          </div>
          {!locked && <p className="rt-group__help">{t('rt.adv.timeoutsHelp')}</p>}
        </fieldset>
      )}

      <div className="ed-grid">
        <Segmented
          label={t('rt.adv.websocket')}
          value={ws}
          onChange={(v) => setDraft(setPath(draft, ['enable_websocket'], v === 'on' ? true : v === 'off' ? false : undefined))}
          options={[
            { value: 'default', label: hasService ? t('rt.adv.ws.service') : t('rt.adv.ws.default') },
            { value: 'on', label: t('rt.adv.ws.on') },
            { value: 'off', label: t('rt.adv.ws.off') },
          ]}
          help={locked ? undefined : t('rt.adv.wsHelp')}
          error={issueAt(issues, 'enable_websocket')}
        />
      </div>

      {(!locked || script !== '' || draft.script_id !== undefined) && (
        <div className="rt-wide">
          <Section title={t('rt.adv.script')} summary={script === '' ? t('rt.adv.scriptNone') : t('rt.adv.scriptSet')} issues={scriptIssues.length}>
            <div className="ed-stack">
              <p className="rt-note rt-note--warn">{t('rt.adv.scriptHelp')}</p>
              <Field label={t('rt.adv.scriptLabel')} error={scriptIssues[0]?.message}>
                <CodeEditor
                  language="lua"
                  aria-label={t('rt.adv.scriptLabel')}
                  aria-invalid={scriptIssues.length > 0 || undefined}
                  minLines={4}
                  maxLines={20}
                  value={script}
                  onChange={(v) => setDraft(setPath(draft, ['script'], v))}
                />
              </Field>
              {draft.script_id !== undefined && (
                <div className="ed-grid">
                  <Input
                    label={t('rt.adv.scriptId')}
                    mono
                    value={typeof draft.script_id === 'string' || typeof draft.script_id === 'number' ? String(draft.script_id) : ''}
                    help={locked ? undefined : t('rt.adv.scriptIdHelp')}
                    error={issueAt(issues, 'script_id')}
                    onChange={(e) => setDraft(setPath(draft, ['script_id'], e.target.value))}
                  />
                </div>
              )}
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}
