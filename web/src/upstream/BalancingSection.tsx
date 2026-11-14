// How a node is picked: the algorithm; for consistent hashing, what is hashed; for round robin,
// slow start (warm_up_conf), which ramps a node APISIX sees for the first time up to its weight.
// Leaving chash removes hash_on and key; slow start on or off adds or removes its block.
import { useId } from 'react';
import type { Obj } from '../api/types';
import { setPath, setPathRaw } from '../editor/draft';
import { t } from '../i18n';
import { useLocked } from '../ui';
import { ChoiceSelect, IssueLine, NumberField, SwitchBlock, TextField } from './fields';
import { bind, byDefault, num, obj, str, type SectionProps } from './values';
import { BALANCERS, balancerLabel, DEFAULT_TYPE } from './meta';

const HASH_ON = ['vars', 'header', 'cookie', 'consumer', 'vars_combinations'];
/** The variables upstream_hash_vars_schema allows (besides arg_<name>). */
const HASH_VARS = ['uri', 'server_name', 'server_addr', 'request_uri', 'remote_port', 'remote_addr', 'query_string', 'host', 'hostname', 'mqtt_client_id'];

function SlowStart({ value, onChange, issues }: Pick<SectionProps, 'value' | 'onChange' | 'issues'>) {
  const warm = obj(value.warm_up_conf);
  const issue = (key: string) => issues.find((i) => i.path === `warm_up_conf.${key}`)?.message;
  // Edits keep the block, also when emptied: the switch is what removes it.
  const set = (key: string, v: unknown) => onChange(setPathRaw(value, ['warm_up_conf'], setPath(warm, [key], v)));
  return (
    <div className="ed-grid">
      <NumberField label={t('up.warm.slowStart')} required integer min={1} value={num(warm.slow_start_time_seconds)} help={t('up.warm.slowStartHelp')} error={issue('slow_start_time_seconds')} onChange={(v) => set('slow_start_time_seconds', v)} />
      <NumberField label={t('up.warm.minWeight')} required integer min={1} max={100} value={num(warm.min_weight_percent)} help={t('up.warm.minWeightHelp')} error={issue('min_weight_percent')} onChange={(v) => set('min_weight_percent', v)} />
      <NumberField label={t('up.warm.interval')} integer min={1} byDefault={1} value={num(warm.interval)} help={t('up.conn.seconds')} error={issue('interval')} onChange={(v) => set('interval', v)} />
      <NumberField label={t('up.warm.aggression')} min={0.01} step={0.1} byDefault={1} value={num(warm.aggression)} help={t('up.warm.aggressionHelp')} error={issue('aggression')} onChange={(v) => set('aggression', v)} />
      <NumberField label={t('up.warm.grace')} integer min={0} byDefault={0} value={num(warm.startup_grace_period_seconds)} help={t('up.warm.graceHelp')} error={issue('startup_grace_period_seconds')} onChange={(v) => set('startup_grace_period_seconds', v)} />
    </div>
  );
}

export function BalancingSection(p: SectionProps) {
  const { value, onChange, issues } = p;
  const { set, issue } = bind(p);
  const locked = useLocked();
  const varsList = useId();
  const type = str(value.type);
  const effective = type ?? DEFAULT_TYPE;
  const hashOn = str(value.hash_on) ?? 'vars';
  const warmOn = value.warm_up_conf !== undefined;

  function setType(next: string | undefined) {
    let up: Obj = setPath(value, ['type'], next);
    if ((next ?? DEFAULT_TYPE) !== 'chash') for (const key of ['hash_on', 'key']) up = setPath(up, [key], undefined);
    onChange(up);
  }

  return (
    <div className="ed-stack">
      <div className="ed-grid">
        <ChoiceSelect
          label={t('up.balance.type')}
          value={type}
          defaultLabel={byDefault(balancerLabel(DEFAULT_TYPE))}
          choices={BALANCERS.map((b) => ({ value: b, label: balancerLabel(b) }))}
          help={(BALANCERS as readonly string[]).includes(effective) ? t(`up.balance.typeHelp.${effective}`) : undefined}
          error={issue('type')}
          onChange={setType}
        />
      </div>
      {effective === 'chash' && (
        <div className="ed-grid">
          <ChoiceSelect
            label={t('up.balance.hashOn')}
            mono
            value={str(value.hash_on)}
            defaultLabel={byDefault('vars')}
            choices={HASH_ON.map((on) => ({ value: on, label: on }))}
            error={issue('hash_on')}
            onChange={(v) => set(['hash_on'], v)}
          />
          {hashOn === 'consumer' ? (
            !locked && <p className="ed-note up-aside">{t('up.balance.keyHelp.consumer')}</p>
          ) : (
            <>
              <TextField
                label={t('up.balance.key')}
                mono
                required
                autoComplete="off"
                list={hashOn === 'vars' ? varsList : undefined}
                value={str(value.key) ?? ''}
                help={HASH_ON.includes(hashOn) ? t(`up.balance.keyHelp.${hashOn}`) : undefined}
                error={issue('key')}
                onChange={(e) => set(['key'], e.target.value)}
              />
              {!locked && hashOn === 'vars' && (
                <datalist id={varsList}>
                  {HASH_VARS.map((v) => (
                    <option key={v} value={v} />
                  ))}
                </datalist>
              )}
            </>
          )}
        </div>
      )}
      {(effective === 'roundrobin' || warmOn) && (
        <SwitchBlock
          title={t('up.warm.title')}
          help={t('up.warm.help')}
          checked={warmOn}
          onToggle={(on) => onChange(on ? setPathRaw(value, ['warm_up_conf'], {}) : setPath(value, ['warm_up_conf'], undefined))}
        >
          <IssueLine message={issue('warm_up_conf')} />
          {warmOn && <SlowStart value={value} onChange={onChange} issues={issues} />}
        </SwitchBlock>
      )}
    </div>
  );
}
