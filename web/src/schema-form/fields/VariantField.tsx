import { useCallback, useState } from 'react';
import type { Obj } from '../../api/types';
import { t } from '../../i18n';
import { Select } from '../../ui';
import type { VariantNode } from '../analyze';
import { useFieldError, useFieldId, useLatest } from '../context';
import { activeOption, isEmpty, switchOption } from '../model';
import { FieldLabel } from './chrome';
import { useFieldHelp } from './help';
import { JsonField } from './JsonField';
import { NodeField } from './NodeField';
import { ObjectBody } from './ObjectField';
import type { FieldProps } from './types';

/**
 * Alternatives (oneOf/anyOf) the analysis can tell apart: a select of the forms, then the chosen
 * form's fields. Switching keeps what both forms have and drops the rest. A value that matches no
 * form is shown, and kept, as JSON.
 */
export function VariantField(props: FieldProps<VariantNode>) {
  const { node, value, name, path, onChange, prop, required, ariaLabel } = props;
  const id = useFieldId(path);
  const error = useFieldError(path);
  const help = useFieldHelp(prop, node, value);
  const [chosen, setChosen] = useState<number>();
  const latestRef = useLatest({ name, onChange, required });
  const emitObject = useCallback(
    (next: Obj) => {
      const { name: key, onChange: change, required: needed } = latestRef.current;
      change(key, isEmpty(next) && !needed ? undefined : next);
    },
    [latestRef],
  );

  const matched = activeOption(node, value);
  const empty = isEmpty(value);
  if (matched < 0 && !empty) return <JsonField {...props} schema={node.schema} note={t('sf.variant.noMatch')} />;
  // The user's pick stands while the value fits it (an emptied value fits any).
  const index = chosen !== undefined && (empty || node.options[chosen]?.matches(value)) ? chosen : Math.max(matched, 0);
  const option = node.options[index];
  const key = prop?.key ?? ariaLabel ?? String(name);
  const inner = option?.node;
  const fieldsInside = inner?.kind === 'object';

  return (
    <div className="sf-variant">
      <div className="sf-variant__picker">
        <Select
          id={`${id}-form`}
          label={prop ? <FieldLabel name={prop.key} title={prop.title} /> : undefined}
          aria-label={prop ? undefined : t('sf.variant.form', { key })}
          help={help}
          // A field inside shows the errors at this path itself; an object's fields do not.
          error={fieldsInside ? error : undefined}
          required={required}
          value={String(index)}
          options={node.options.map((o, i) => ({ value: String(i), label: o.label }))}
          onChange={(picked) => {
            const to = Number(picked);
            if (!Number.isInteger(to) || to === index) return;
            setChosen(to);
            onChange(name, switchOption(node, index, to, value));
          }}
        />
      </div>
      {inner && (
        <div className="sf-variant__body">
          {inner.kind === 'object' ? (
            <ObjectBody node={inner} value={value} path={path} emit={emitObject} />
          ) : (
            <NodeField node={inner} value={value} name={name} path={path} onChange={onChange} required={required} ariaLabel={key} />
          )}
        </div>
      )}
    </div>
  );
}
