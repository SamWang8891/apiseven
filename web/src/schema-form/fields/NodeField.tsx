import { memo } from 'react';
import { isWide } from '../analyze';
import { fits } from '../model';
import { BooleanField } from './BooleanField';
import { EnumField } from './EnumField';
import { JsonField } from './JsonField';
import { ListField } from './ListField';
import { MapField } from './MapField';
import { NumberField } from './NumberField';
import { ObjectField } from './ObjectField';
import { StringField } from './StringField';
import { TagsField } from './TagsField';
import type { FieldProps } from './types';
import { VariantField } from './VariantField';

function FieldFor(props: FieldProps) {
  const { node, value } = props;
  // A value the field cannot show as it is (an object where text goes) is shown, and kept, as JSON.
  if (node.kind !== 'variant' && node.kind !== 'map' && !fits(node, value)) return <JsonField {...props} />;
  switch (node.kind) {
    case 'string':
      return <StringField {...props} node={node} />;
    case 'number':
      return <NumberField {...props} node={node} />;
    case 'boolean':
      return <BooleanField {...props} node={node} />;
    case 'enum':
      return <EnumField {...props} node={node} />;
    case 'object':
      return <ObjectField {...props} node={node} />;
    case 'array-scalar':
      return <TagsField {...props} node={node} />;
    case 'array-object':
      return <ListField {...props} node={node} />;
    case 'map':
      return <MapField {...props} node={node} />;
    case 'variant':
      return <VariantField {...props} node={node} />;
    case 'json':
      return <JsonField {...props} schema={node.schema} />;
  }
}

/**
 * One field of the form, by its node's kind, in a grid cell (full width for groups, lists, maps,
 * variants, JSON and multi-line text). Memoised: an edit re-renders only the fields whose value changed.
 */
export const NodeField = memo(function NodeField(props: FieldProps) {
  const wide = isWide(props.node) || (props.node.kind !== 'variant' && props.node.kind !== 'map' && !fits(props.node, props.value));
  return (
    <div className={wide ? 'sf-cell sf-cell--wide' : 'sf-cell'}>
      <FieldFor {...props} />
    </div>
  );
});
