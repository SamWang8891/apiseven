import { CircleAlert } from 'lucide-react';
import type { FC, ReactNode } from 'react';
import { t } from '../i18n';
import { errorId, helpId } from './fieldIds';
import { useLocked } from './LockContext';
import './field.css';

/** Label, help and error shared by every input. `error` replaces `help` while it is set. */
export interface FieldProps {
  label?: ReactNode;
  help?: ReactNode;
  error?: string;
  required?: boolean;
  /** The control's id: links the label to it and names the help/error ids it describes itself with. */
  htmlFor?: string;
}

/** Kit-internal extras: an `action` at the end of the label row (KeyValueInput's "Add entry"), and
 * `controlId`, the id the help/error ids are named after (default `htmlFor`), for a control whose
 * label is not this one, such as a Checkbox labelled by its inline text. */
export const Field: FC<FieldProps & { children: ReactNode; action?: ReactNode; controlId?: string }> = ({
  label,
  help,
  error,
  required,
  htmlFor,
  action,
  controlId = htmlFor,
  children,
}) => {
  // "Required" is an instruction for editing; a locked page shows values, not instructions.
  const locked = useLocked();
  const showRequired = required && !locked;
  return (
    <div className={error ? 'ui-field ui-field--error' : 'ui-field'}>
      {(label !== undefined || action !== undefined) && (
        <div className="ui-field__head">
          {label !== undefined && (
            <label className="ui-field__label" htmlFor={htmlFor}>
              {label}
              {showRequired && (
                <>
                  {/* Separates the words in the accessible name; a flex container does not render it. */}{' '}
                  <span className="ui-field__required">
                    <span aria-hidden="true">*</span>
                    <span className="ui-sr-only">({t('ui.required')})</span>
                  </span>
                </>
              )}
            </label>
          )}
          {action}
        </div>
      )}
      {children}
      {error ? (
        <p className="ui-field__error" id={controlId && errorId(controlId)}>
          <CircleAlert aria-hidden="true" size={14} strokeWidth={2.25} />
          <span>{error}</span>
        </p>
      ) : (
        help !== undefined && (
          <p className="ui-field__help" id={controlId && helpId(controlId)}>
            {help}
          </p>
        )
      )}
    </div>
  );
};
