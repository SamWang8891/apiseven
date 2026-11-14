// Picks a stored object to reference (`upstream_id`, `service_id`, `tls.client_cert_id`, …): a
// searchable select listing objects by name with the id beside it, and a link to the one chosen.
// An id that matches no object stays selected and is flagged (it may be a typo, or the object was
// deleted): it is never cleared behind the user's back. Locked, it reads as a link to the object.
// While the list is still loading (`loading`), an id it doesn't hold yet is shown as it is, with a
// quiet note, never as "not found".
import { ExternalLink } from 'lucide-react';
import type { FC, ReactNode } from 'react';
import { Link } from 'react-router';
import type { Item, Kind } from '../api/types';
import { t } from '../i18n';
import { pathFor } from '../router/paths';
import { Field, Select, useLocked, type Option } from '../ui';
import { ReadOnlyValue } from '../ui/ReadOnly';
import { nameOfValue } from './resolve';
import './resources.css';

export interface ResourcePickerProps {
  kind: Kind;
  items: Item[];
  value: string | undefined;
  onChange: (id: string | undefined) => void;
  label?: ReactNode;
  help?: ReactNode;
  error?: string;
  clearable?: boolean;
  /** Which items to offer (the chosen one is always shown, whether or not it passes). */
  filter?: (item: Item) => boolean;
  placeholder?: string;
  /** The list hasn't loaded yet (`!ctx.loaded.<list>`): an id it lacks is not called "not found". */
  loading?: boolean;
}

const nameOf = (item: Item): string => nameOfValue(item.value) ?? item.id;

function optionOf(item: Item): Option {
  const name = nameOf(item);
  return name === item.id ? { value: item.id, label: name } : { value: item.id, label: name, description: item.id };
}

export const ResourcePicker: FC<ResourcePickerProps> = ({ kind, items, value, onChange, label, help, error, clearable, filter, placeholder, loading }) => {
  const locked = useLocked();
  const chosen = value === undefined ? undefined : items.find((item) => String(item.id) === value);
  const unmatched = value !== undefined && !chosen;
  const missing = unmatched && !loading ? t('picker.notFound', { id: value }) : undefined;
  const waiting = unmatched && loading;

  if (locked) {
    return (
      <Field label={label} help={help} error={error}>
        <ReadOnlyValue className="res-picker__ro">
          {value === undefined ? undefined : chosen ? (
            <>
              <Link className="res-picker__link" to={pathFor(kind, chosen.id)}>
                {nameOf(chosen)}
              </Link>
              {nameOf(chosen) !== chosen.id && <span className="res-picker__id mono">{chosen.id}</span>}
            </>
          ) : waiting ? (
            <>
              <span className="mono">{value}</span>
              <span className="res-picker__loading">{t('picker.loading')}</span>
            </>
          ) : (
            <span className="res-picker__missing">{missing}</span>
          )}
        </ReadOnlyValue>
      </Field>
    );
  }

  const offered = items.filter((item) => item === chosen || !filter || filter(item));
  return (
    <div className={label === undefined ? 'res-picker res-picker--bare' : 'res-picker'}>
      <Select
        label={label}
        help={waiting ? t('picker.loading') : help}
        error={error ?? missing}
        value={value}
        onChange={onChange}
        options={offered.map(optionOf)}
        searchable
        clearable={clearable}
        monoDescription
        placeholder={placeholder}
        className="res-picker__select"
      />
      {chosen && (
        <Link className="res-picker__open" to={pathFor(kind, chosen.id)} aria-label={t('picker.open', { name: nameOf(chosen) })}>
          <ExternalLink size={13} aria-hidden="true" />
          {t('picker.openShort')}
        </Link>
      )}
    </div>
  );
};
