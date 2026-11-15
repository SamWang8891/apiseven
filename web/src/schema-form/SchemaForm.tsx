// A form generated from a JSON Schema (an APISIX plugin's schema, a secret manager's, …), editing a
// plain JSON value. It writes only the keys it renders: keys the schema lacks are kept as they are
// (and named in a note), defaults are placeholders that are never written, clearing a field deletes
// its key. Locked (a LockProvider above), every field reads as text.
import { useCallback, useId, useMemo, type FC } from 'react';
import type { Obj } from '../api/types';
import { isObj } from '../schema/refs';
import { TooltipProvider } from '../ui';
import { analyze } from './analyze';
import { FormContext, useLatest, useStableByKey } from './context';
import { placeErrors, type FormError } from './errors';
import { ErrorLine } from './fields/chrome';
import { NodeField } from './fields/NodeField';
import { ObjectBody } from './fields/ObjectField';
import type { Key } from './model';
import './schema-form.css';

export interface SchemaFormProps {
  schema: Obj;
  value: unknown;
  onChange: (v: unknown) => void;
  /** Secret fields beyond the schema's own top-level `encrypt_fields` (which analyze reads itself); dotted paths. */
  encryptFields?: string[];
  /**
   * Errors by dotted path relative to `value` ('' = the root, 'redis.host', 'rules.0.match'). Each
   * shows on the field at its path, or on the nearest field that is rendered (a collapsed group
   * holding one opens); those that reach the root show above the form.
   */
  errors?: FormError[];
  /** Prefix of the fields' DOM ids (fieldId(prefix, path)); a generated one by default. */
  idPrefix?: string;
  /** What messages about held input start with (a plugin's name), before the field's dotted path. */
  name?: string;
  /**
   * The stored counterpart of `value` as the editor last loaded it from APISIX (a plugin's stored
   * config, a stored entry without its id); undefined for a new object or a part not stored. A secret
   * field reads "the stored value" at its own path here, never from what it saw when it mounted.
   */
  baseline?: unknown;
}

const NO_ERRORS: FormError[] = [];

export const SchemaForm: FC<SchemaFormProps> = ({ schema, value, onChange, encryptFields, errors = NO_ERRORS, idPrefix, name, baseline }) => {
  const encryptKey = (encryptFields ?? []).join('\n');
  const node = useMemo(() => analyze(schema, { encryptFields: encryptKey === '' ? [] : encryptKey.split('\n') }), [schema, encryptKey]);
  const generated = useId().replace(/[^\w-]/g, '');
  const prefix = idPrefix ?? `sf${generated}`;

  // Placement follows the value (a field may appear or go), but keeps its identity while it is the
  // same, so fields re-render only when what they show changes.
  const placed = useMemo(() => placeErrors(node, value, errors), [node, value, errors]);
  const stable = useStableByKey(placed, JSON.stringify([...placed]));
  // The secret paths, for masking secrets the fields cannot see (inside a locked JSON value).
  const encrypt = useMemo(() => {
    const own: unknown[] = Array.isArray(schema.encrypt_fields) ? (schema.encrypt_fields as unknown[]) : [];
    return [...new Set([...own, ...encryptKey.split('\n')])].filter((p): p is string => typeof p === 'string' && p !== '');
  }, [schema, encryptKey]);
  const context = useMemo(() => ({ prefix, name, encrypt, errors: stable, baseline }), [prefix, name, encrypt, stable, baseline]);

  const latestRef = useLatest(onChange);
  const emit = useCallback((_: Key, v: unknown) => latestRef.current(v), [latestRef]);
  const emitRoot = useCallback((next: Obj) => latestRef.current(next), [latestRef]);
  const rootErrors = stable.get('');

  return (
    <TooltipProvider>
      <FormContext value={context}>
        <div className="sf">
          {rootErrors && rootErrors.length > 0 && (
            <div className="sf-errors" role="alert">
              {rootErrors.map((message, i) => (
                <ErrorLine key={i} message={message} />
              ))}
            </div>
          )}
          {node.kind === 'object' && (value === undefined || isObj(value)) ? (
            <ObjectBody node={node} value={value} path="" emit={emitRoot} />
          ) : (
            <NodeField node={node} value={value} name="" path="" onChange={emit} required={false} />
          )}
        </div>
      </FormContext>
    </TooltipProvider>
  );
};
