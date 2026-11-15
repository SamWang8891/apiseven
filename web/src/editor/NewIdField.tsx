// The ID field of a new object whose id is not a field of its body (routes, credentials, groups …),
// above the tabs. It says when the id is taken (Editor: a refused create, or an object of a loaded
// list with that id) and links to the object that has it; the GET before the create decides.
import type { Ref } from 'react';
import { Link } from 'react-router';
import type { Kind, Parent } from '../api/types';
import { t } from '../i18n';
import { registry } from '../resources/registry';
import { pathFor } from '../router/paths';
import { Input } from '../ui';

export interface NewIdFieldProps {
  kind: Kind;
  parent?: Parent;
  value: string;
  onChange: (id: string) => void;
  inputRef: Ref<HTMLInputElement>;
  /** A required id is missing and a Save was tried. */
  missing: boolean;
  /** The id, when an object already has it. */
  taken?: string;
}

export function NewIdField({ kind, parent, value, onChange, inputRef, missing, taken }: NewIdFieldProps) {
  const def = registry[kind];
  return (
    <div className="ed-newid">
      <Input
        ref={inputRef}
        label={t('editor.id.label')}
        mono
        required={def.idMode !== 'optional'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        help={def.idMode === 'optional' ? t('editor.id.optional') : t('editor.id.requiredHelp')}
        error={missing ? t('editor.id.required') : taken !== undefined ? t('editor.taken.message', { kind: def.singular, id: taken }) : undefined}
      />
      {taken !== undefined && (
        <Link className="ed-newid__taken" to={pathFor(kind, taken, parent)}>
          {t('editor.taken.open', { kind: def.singular, id: taken })}
        </Link>
      )}
    </div>
  );
}
