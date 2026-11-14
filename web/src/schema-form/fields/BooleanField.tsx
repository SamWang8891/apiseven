import { t } from '../../i18n';
import { Select, Switch, useLocked } from '../../ui';
import type { Node } from '../analyze';
import { useFieldError, useFieldId } from '../context';
import { FieldLabel } from './chrome';
import { useFieldHelp } from './help';
import type { FieldProps } from './types';

const DEFAULT = 'default';
const ON = 'on';
const OFF = 'off';

/**
 * A boolean is tri-state: unset (the schema's default applies), on, off. Unset, it is a select
 * `Default (…) / On / Off`; once set, a switch with a Reset that deletes the key again.
 */
export function BooleanField({ node, value, name, path, onChange, prop, required, ariaLabel }: FieldProps<Extract<Node, { kind: 'boolean' }>>) {
  const locked = useLocked();
  const id = useFieldId(path);
  const error = useFieldError(path);
  const help = useFieldHelp(prop, node, value);
  const label = prop ? <FieldLabel name={prop.key} title={prop.title} /> : undefined;
  const common = { id, label, help, error, required, 'aria-label': label ? undefined : ariaLabel };

  if (typeof value !== 'boolean') {
    const fallback = prop && 'default' in prop ? prop.default : undefined;
    const defaultLabel =
      typeof fallback === 'boolean' ? t('sf.bool.default', { value: fallback ? t('ui.on') : t('ui.off') }) : t('sf.bool.noDefault');
    const options = [
      ...(required ? [] : [{ value: DEFAULT, label: defaultLabel }]),
      { value: ON, label: t('ui.on') },
      { value: OFF, label: t('ui.off') },
    ];
    return (
      <Select
        {...common}
        value={required ? undefined : DEFAULT}
        options={options}
        onChange={(v) => {
          if (v === ON || v === OFF) onChange(name, v === ON);
        }}
      />
    );
  }

  return (
    <div className="sf-bool">
      <Switch {...common} checked={value} onChange={(checked) => onChange(name, checked)} />
      {!locked && (
        <button type="button" className="sf-link sf-bool__reset" onClick={() => onChange(name, undefined)}>
          {t('sf.bool.unset')}
        </button>
      )}
    </div>
  );
}
