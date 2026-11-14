// How APISIX talks to the nodes: scheme, timeouts, retries, the keepalive pool and the Host header.
// APISIX takes `timeout` only with all three of connect/send/read, so filling one fills the empty
// others with nginx's 60s and clearing all three removes it. `upstream_host` belongs to
// pass_host: rewrite and goes when pass_host changes to anything else.
import { setPath } from '../editor/draft';
import { t } from '../i18n';
import { ChoiceSelect, Group, NumberField, TextField } from './fields';
import { bind, byDefault, num, obj, str, type SectionProps } from './values';
import { DEFAULT_SCHEME } from './meta';

/** The schema's `scheme` enum, the HTTP ones first. */
const SCHEMES = ['http', 'https', 'grpc', 'grpcs', 'ws', 'wss', 'tcp', 'tls', 'udp', 'kafka'];
const PASS_HOST = ['pass', 'node', 'rewrite'];
const TIMEOUTS = ['connect', 'send', 'read'] as const;
/** nginx's proxy_*_timeout default, which APISIX keeps when `timeout` is unset. */
const NGINX_TIMEOUT = 60;

export function ConnectionSection(p: SectionProps) {
  const { value, onChange } = p;
  const { get, set, issue } = bind(p);
  const timeout = obj(value.timeout);
  const pool = obj(value.keepalive_pool);
  const pass = str(value.pass_host);

  function setTimeoutField(key: (typeof TIMEOUTS)[number], v: number | undefined) {
    if (v === undefined) {
      onChange(setPath(value, ['timeout', key], undefined));
      return;
    }
    const filled = Object.fromEntries(TIMEOUTS.map((k) => [k, timeout[k] ?? NGINX_TIMEOUT]));
    onChange(setPath(value, ['timeout'], { ...timeout, ...filled, [key]: v }));
  }

  return (
    <div className="ed-stack">
      <div className="ed-grid">
        <ChoiceSelect
          label={t('up.conn.scheme')}
          mono
          value={str(value.scheme)}
          defaultLabel={byDefault(DEFAULT_SCHEME)}
          choices={SCHEMES.map((s) => ({ value: s, label: s }))}
          error={issue('scheme')}
          onChange={(v) => set(['scheme'], v)}
        />
        <ChoiceSelect
          label={t('up.conn.passHost')}
          value={pass}
          defaultLabel={byDefault('pass')}
          choices={PASS_HOST.map((v) => ({ value: v, label: t(`up.conn.pass.${v}`) }))}
          error={issue('pass_host')}
          onChange={(v) => onChange(setPath(v === 'rewrite' ? value : setPath(value, ['upstream_host'], undefined), ['pass_host'], v))}
        />
        {pass === 'rewrite' && (
          <>
            <span aria-hidden="true" />
            <TextField
              label={t('up.conn.upstreamHost')}
              mono
              required
              autoComplete="off"
              value={str(value.upstream_host) ?? ''}
              help={t('up.conn.upstreamHostHelp')}
              error={issue('upstream_host')}
              onChange={(e) => set(['upstream_host'], e.target.value)}
            />
          </>
        )}
      </div>

      <Group title={t('up.conn.timeouts')} three after={<p className="up-help">{t('up.conn.timeoutsHelp')}</p>}>
          {TIMEOUTS.map((key) => (
            <NumberField
              key={key}
              label={t(`up.conn.${key}`)}
              min={0}
              byDefault={NGINX_TIMEOUT}
              value={num(timeout[key])}
              error={issue(`timeout.${key}`)}
              onChange={(v) => setTimeoutField(key, v)}
            />
          ))}
      </Group>

      <div className="ed-grid">
        <NumberField label={t('up.conn.retries')} integer min={0} byDefault={t('up.conn.retriesDefault')} value={num(get(['retries']))} help={t('up.conn.retriesHelp')} error={issue('retries')} onChange={(v) => set(['retries'], v)} />
        <NumberField label={t('up.conn.retryTimeout')} min={0} byDefault={t('up.conn.retryTimeoutDefault')} value={num(get(['retry_timeout']))} help={t('up.conn.retryTimeoutHelp')} error={issue('retry_timeout')} onChange={(v) => set(['retry_timeout'], v)} />
      </div>

      <Group title={t('up.conn.pool')} three>
          <NumberField label={t('up.conn.poolSize')} integer min={1} byDefault={320} value={num(pool.size)} help={t('up.conn.poolSizeHelp')} error={issue('keepalive_pool.size')} onChange={(v) => set(['keepalive_pool', 'size'], v)} />
          <NumberField label={t('up.conn.poolIdle')} min={0} byDefault={60} value={num(pool.idle_timeout)} help={t('up.conn.seconds')} error={issue('keepalive_pool.idle_timeout')} onChange={(v) => set(['keepalive_pool', 'idle_timeout'], v)} />
          <NumberField label={t('up.conn.poolRequests')} integer min={1} byDefault={1000} value={num(pool.requests)} error={issue('keepalive_pool.requests')} onChange={(v) => set(['keepalive_pool', 'requests'], v)} />
      </Group>
    </div>
  );
}
