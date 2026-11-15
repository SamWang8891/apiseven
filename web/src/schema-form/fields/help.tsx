// The help under a field: the description (two lines; the rest in a tooltip), then the constraints
// while editing; on a locked form, the default of an unset field instead (constraint hints such as
// "matches a pattern" or "≥ 1" are for entering a value, not for reading one).
import type { ReactNode } from 'react';
import { t } from '../../i18n';
import { useLocked } from '../../ui';
import type { Node, Prop } from '../analyze';
import { HelpText } from './chrome';
import { constraintsOf, formatDefault } from './hints';

/** The help under a field: description, then constraints while editing (the default while locked and unset). */
export function useFieldHelp(prop: Prop | undefined, node: Node, value: unknown): ReactNode | undefined {
  const locked = useLocked();
  const meta = locked ? [] : constraintsOf(node);
  // An unset boolean's select already names its default.
  if (locked && value === undefined && node.kind !== 'boolean' && prop && 'default' in prop) meta.push(t('sf.default', { value: formatDefault(prop.default) }));
  const description = prop?.description;
  if (description === undefined && meta.length === 0) return undefined;
  return (
    <>
      {description !== undefined && <HelpText text={description} />}
      {meta.length > 0 && <span className="sf-meta">{meta.join('; ')}</span>}
    </>
  );
}
