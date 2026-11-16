// The ID field of a new object whose id is not a field of its body (routes, credentials, groups …),
// above the tabs, or the kind's own control for it (ResourceDef.NewId: a secret's manager and id, a
// plugin metadata's plugin). It says when the id is taken (Editor: a refused create, or an object of
// a loaded list with that id) and links to the object that has it; the GET before the create decides.
import type { Ref } from 'react';
import { Link } from 'react-router';
import type { Kind, Obj, Parent } from '../api/types';
import { t } from '../i18n';
import { registry } from '../resources/registry';
import { pathFor } from '../router/paths';
import { Input, type PendingEntry } from '../ui';

export interface NewIdFieldProps {
  kind: Kind;
  parent?: Parent;
  value: string;
  onChange: (id: string) => void;
  /** For a kind's own control (NewId), which may start the draft over (a secret manager's blank). */
  draft: Obj;
  setDraft: (next: Obj) => void;
  inputRef: Ref<HTMLInputElement>;
  /** A required id is missing, and a Save was tried or the field typed in. */
  missing: boolean;
  /** Why the kind can't take the id as it is (ResourceDef.idProblem); shown at once, unless it only says a part is missing (the frame waits as for `missing`). */
  refused?: string;
  /** The id, when an object already has it. */
  taken?: string;
  /** The user typed in a text box of the field (the frame's "touched", Task 16b item 154). */
  onTyped?: () => void;
  /** For a kind's own control (NewId): what the form tab's fields hold, which a change that starts the draft over discards (NewIdProps.held). */
  held?: PendingEntry[];
}

export function NewIdField({ kind, parent, value, onChange, draft, setDraft, inputRef, missing, refused, taken, onTyped, held }: NewIdFieldProps) {
  const def = registry[kind];
  const error = missing ? t('editor.id.required') : (refused ?? (taken !== undefined ? t('editor.taken.message', { kind: def.singular, id: taken }) : undefined));
  const Own = def.NewId;
  return (
    <div className={Own ? 'ed-newid ed-newid--own' : 'ed-newid'} onInput={(e) => e.target instanceof HTMLInputElement && onTyped?.()}>
      {Own ? (
        <Own value={value} onChange={onChange} draft={draft} setDraft={setDraft} error={error} inputRef={inputRef} held={held} />
      ) : (
        <Input
          ref={inputRef}
          label={t('editor.id.label')}
          mono
          required={def.idMode !== 'optional'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          help={def.idMode === 'optional' ? t('editor.id.optional') : t('editor.id.requiredHelp')}
          error={error}
        />
      )}
      {taken !== undefined && (
        <Link className="ed-newid__taken" to={pathFor(kind, taken, parent)}>
          {t('editor.taken.open', { kind: def.singular, id: taken })}
        </Link>
      )}
    </div>
  );
}
