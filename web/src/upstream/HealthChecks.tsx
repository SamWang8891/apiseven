// Health checks (`checks`, the schema's health_checker): active probes, and passive checks that
// watch real responses. Each is behind a switch that adds or removes its block; passive checks need
// active ones (the schema requires `active`, and only a probe can bring a node back), so turning
// active off removes `checks` altogether. Fields that only apply to HTTP hide for TCP.
import type { Obj } from '../api/types';
import { getPath, setPath } from '../editor/draft';
import { issueAt } from '../editor/issues';
import { t } from '../i18n';
import { Switch } from '../ui';
import { ChoiceSelect, Group, IssueLine, LinesInput, NumberField, StatusesInput, SwitchBlock, TextField } from './fields';
import { byDefault, num, obj, str, type SectionProps } from './values';

const PROTOCOLS = ['http', 'https', 'tcp'];

/** A copy of `o` without `keys`. */
function without(o: Obj, ...keys: string[]): Obj {
  return Object.fromEntries(Object.entries(o).filter(([key]) => !keys.includes(key)));
}
const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'CONNECT', 'TRACE', 'PURGE'];

export function HealthChecks({ value, onChange, issues }: SectionProps) {
  const checks = obj(value.checks);
  const active = checks.active === undefined ? undefined : obj(checks.active);
  const passive = checks.passive === undefined ? undefined : obj(checks.passive);

  /** Reads and writes inside one block; an edit keeps the block, also when emptied. */
  const block = (which: 'active' | 'passive') => {
    const conf = obj(checks[which]);
    return {
      get: (...path: string[]) => getPath(conf, path),
      set: (path: string[], v: unknown) => onChange(setPath(value, ['checks'], { ...checks, [which]: setPath(conf, path, v) })),
      issue: (...path: string[]) => issueAt(issues, ['checks', which, ...path].join('.')),
    };
  };
  const a = block('active');
  const p = block('passive');
  type Bound = typeof a;

  const number = (b: Bound, path: string[], label: string, opts: { min?: number; max?: number; integer?: boolean; byDefault?: number | string; help?: string }) => (
    <NumberField
      label={label}
      integer={opts.integer ?? true}
      min={opts.min}
      max={opts.max}
      byDefault={opts.byDefault}
      help={opts.help}
      value={num(b.get(...path))}
      error={b.issue(...path)}
      onChange={(v) => b.set(path, v)}
    />
  );
  const statuses = (b: Bound, path: string[], defaults: string) => (
    <div className="ed-wide">
      <StatusesInput label={t('up.hc.statuses')} byDefault={defaults} value={b.get(...path)} error={b.issue(...path)} onChange={(v) => b.set(path, v)} />
    </div>
  );
  const protocol = (b: Bound) => (
    <ChoiceSelect
      label={t('up.hc.type')}
      mono
      value={str(b.get('type'))}
      defaultLabel={byDefault('http')}
      choices={PROTOCOLS.map((p) => ({ value: p, label: p }))}
      error={b.issue('type')}
      onChange={(v) => b.set(['type'], v)}
    />
  );

  const activeType = str(active?.type) ?? 'http';
  const passiveType = str(passive?.type) ?? 'http';
  const http = activeType !== 'tcp';

  return (
    <div className="ed-stack up-hc">
      <SwitchBlock
        title={t('up.hc.active')}
        checked={active !== undefined}
        help={t('up.hc.activeHelp')}
        onToggle={(on) => {
          if (on) onChange(setPath(value, ['checks'], { ...checks, active: {} }));
          // Passive checks can't stay without active ones.
          else onChange(setPath(value, ['checks'], without(checks, 'active', 'passive')));
        }}
      >
        <IssueLine message={issueAt(issues, 'checks') ?? issueAt(issues, 'checks.active')} />
        {active !== undefined && (
          <>
            <Group title={t('up.hc.probe')}>
              {protocol(a)}
              {http && (
                <ChoiceSelect
                  label={t('up.hc.method')}
                  mono
                  value={str(active.http_method)}
                  defaultLabel={byDefault('GET')}
                  choices={METHODS.map((m) => ({ value: m, label: m }))}
                  error={a.issue('http_method')}
                  onChange={(v) => a.set(['http_method'], v)}
                />
              )}
              {http && (
                <TextField label={t('up.hc.path')} mono byDefault="/" value={str(active.http_path) ?? ''} error={a.issue('http_path')} onChange={(e) => a.set(['http_path'], e.target.value)} />
              )}
              <TextField label={t('up.hc.host')} mono byDefault={t('up.hc.hostDefault')} value={str(active.host) ?? ''} error={a.issue('host')} onChange={(e) => a.set(['host'], e.target.value)} />
              {number(a, ['port'], t('up.hc.port'), { min: 1, max: 65535, byDefault: t('up.hc.portDefault') })}
              {number(a, ['timeout'], t('up.hc.timeout'), { integer: false, min: 0, byDefault: 1, help: t('up.conn.seconds') })}
              {number(a, ['concurrency'], t('up.hc.concurrency'), { byDefault: 10, help: t('up.hc.concurrencyHelp') })}
              {activeType === 'https' && (
                <Switch
                  label={t('up.hc.verifyCert')}
                  checked={active.https_verify_certificate !== false}
                  onLabel={t('up.tls.verifyOn')}
                  offLabel={t('up.tls.verifyOff')}
                  onChange={(on) => a.set(['https_verify_certificate'], on ? undefined : false)}
                />
              )}
              {http && (
                <div className="ed-wide">
                  <TextField label={t('up.hc.body')} mono value={str(active.http_req_body) ?? ''} error={a.issue('http_req_body')} onChange={(e) => a.set(['http_req_body'], e.target.value)} />
                </div>
              )}
              {http && (
                <div className="ed-wide">
                  <LinesInput
                    label={t('up.hc.headers')}
                    help={t('up.hc.headersHelp')}
                    value={Array.isArray(active.req_headers) ? active.req_headers.filter((h): h is string => typeof h === 'string') : []}
                    error={a.issue('req_headers')}
                    onChange={(v) => a.set(['req_headers'], v)}
                  />
                </div>
              )}
            </Group>
            <Group title={t('up.hc.healthy')}>
              {number(a, ['healthy', 'interval'], t('up.hc.interval'), { min: 1, byDefault: 1, help: t('up.conn.seconds') })}
              {number(a, ['healthy', 'successes'], t('up.hc.successes'), { min: 1, max: 254, byDefault: 2 })}
              {http && statuses(a, ['healthy', 'http_statuses'], '200, 302')}
            </Group>
            <Group title={t('up.hc.unhealthy')}>
              {number(a, ['unhealthy', 'interval'], t('up.hc.interval'), { min: 1, byDefault: 1, help: t('up.conn.seconds') })}
              {http && number(a, ['unhealthy', 'http_failures'], t('up.hc.httpFailures'), { min: 1, max: 254, byDefault: 5 })}
              {number(a, ['unhealthy', 'tcp_failures'], t('up.hc.tcpFailures'), { min: 1, max: 254, byDefault: 2 })}
              {number(a, ['unhealthy', 'timeouts'], t('up.hc.timeouts'), { min: 1, max: 254, byDefault: 3 })}
              {http && statuses(a, ['unhealthy', 'http_statuses'], '429, 404, 500, 501, 502, 503, 504, 505')}
            </Group>
          </>
        )}
      </SwitchBlock>

      <SwitchBlock
        title={t('up.hc.passive')}
        checked={passive !== undefined}
        disabled={active === undefined && passive === undefined}
        help={active === undefined ? t('up.hc.passiveNeedsActive') : t('up.hc.passiveHelp')}
        onToggle={(on) => onChange(setPath(value, ['checks'], on ? { ...checks, passive: {} } : without(checks, 'passive')))}
      >
        <IssueLine message={issueAt(issues, 'checks.passive')} />
        {passive !== undefined && (
          <>
            <div className="ed-grid">{protocol(p)}</div>
            <Group title={t('up.hc.passiveHealthy')}>
              {number(p, ['healthy', 'successes'], t('up.hc.successes'), { min: 0, max: 254, byDefault: 5 })}
              {passiveType !== 'tcp' && statuses(p, ['healthy', 'http_statuses'], '200–208, 226, 300–308')}
            </Group>
            <Group title={t('up.hc.passiveUnhealthy')}>
              {passiveType !== 'tcp' && number(p, ['unhealthy', 'http_failures'], t('up.hc.httpFailures'), { min: 0, max: 254, byDefault: 5 })}
              {number(p, ['unhealthy', 'tcp_failures'], t('up.hc.tcpFailures'), { min: 0, max: 254, byDefault: 2 })}
              {number(p, ['unhealthy', 'timeouts'], t('up.hc.timeouts'), { min: 0, max: 254, byDefault: 7 })}
              {passiveType !== 'tcp' && statuses(p, ['unhealthy', 'http_statuses'], '429, 500, 503')}
            </Group>
          </>
        )}
      </SwitchBlock>
    </div>
  );
}
