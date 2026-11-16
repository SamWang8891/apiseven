// What the bulk Delete confirmation says about each selected object's users (useResourceActions).
import { TriangleAlert } from 'lucide-react';
import { useMemo } from 'react';
import type { Item, Kind } from '../api/types';
import { t } from '../i18n';
import type { Ctx } from '../resources/ctx';
import { listNames } from '../resources/protos/columns';
import { registry } from '../resources/registry';
import { referenceIndex } from '../resources/resolve';
import { References } from './RowActions';
import './list.css';

/**
 * What uses each selected object, as the single Delete dialog shows it (References), under the
 * object's name; one line instead while the lists they come from load, or when one could not be read
 * (the same lists for every object of a kind). The lists are read once for the context (one reverse
 * index), whatever the number of objects selected.
 */
export function BulkReferences({ kind, items, ctx }: { kind: Kind; items: Item[]; ctx: Ctx }) {
  const def = registry[kind];
  const lookup = useMemo(() => referenceIndex(kind, ctx), [kind, ctx]);
  const uses = items.map((item) => ({ item, use: lookup(item.id) }));
  const failed = uses.find((u) => 'failed' in u.use)?.use;
  if (failed && 'failed' in failed) {
    return (
      <p className="list-refs__warning">
        <TriangleAlert size={14} aria-hidden="true" />
        <span>{t('bulk.delete.unknown', { lists: listNames(failed.failed) })}</span>
      </p>
    );
  }
  if (uses.some((u) => 'loading' in u.use)) return <p className="list-refs__warning">{t('bulk.delete.checking')}</p>;
  return uses
    .filter(({ use }) => 'refs' in use && use.refs.length > 0)
    .map(({ item, use }) => (
      <div key={item.id} role="group" aria-label={def.nameOf(item)} className="list-refs__item">
        <p className="list-refs__name">{def.nameOf(item)}</p>
        <References kind={kind} id={item.id} ctx={ctx} use={use} />
      </div>
    ));
}
