import { ChevronRight, Info } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import type { Obj } from '../../api/types';
import { t } from '../../i18n';
import { isObj } from '../../schema/refs';
import { isWide, type ObjectNode } from '../analyze';
import { useErrorBelow, useFieldError, useFieldId, useLatest } from '../context';
import { isEmpty, joinPath, objectView, setKey, type Block, type Key, type Shown } from '../model';
import { ErrorLine, FieldLabel, RequiredMark } from './chrome';
import { NodeField } from './NodeField';
import type { FieldProps } from './types';

const NONE: Obj = {};
const SUMMARY_KEYS = 6;

function Fields({ fields, value, path, onChange }: { fields: Shown[]; value: Obj; path: string; onChange: (name: Key, v: unknown) => void }) {
  return fields.map(({ prop, required }) => (
    <NodeField
      key={prop.key}
      node={prop.node}
      prop={prop}
      required={required}
      value={value[prop.key]}
      name={prop.key}
      path={joinPath(path, prop.key)}
      onChange={onChange}
    />
  ));
}

function CondBlock({ block, value, path, onChange }: { block: Block; value: Obj; path: string; onChange: (name: Key, v: unknown) => void }) {
  return (
    <section className="sf-cond" aria-label={block.caption}>
      <p className="sf-cond__caption">{block.caption}</p>
      <div className="sf-grid">
        <Fields fields={block.fields} value={value} path={path} onChange={onChange} />
      </div>
    </section>
  );
}

/**
 * The fields in display order with each condition's block placed after the row of the field it
 * is about (in two columns: after the field beside it), so choosing `policy: redis` shows the redis
 * fields right below; blocks about nothing shown go after the one-line fields.
 */
function arrange(fields: Shown[], blocks: Block[]): (Shown | Block)[] {
  const out: (Shown | Block)[] = [];
  const due: Block[] = [];
  const loose = blocks.filter((b) => b.after === undefined);
  let column = 0;
  const flush = () => {
    out.push(...due.splice(0));
    column = 0;
  };
  for (const field of fields) {
    const wide = isWide(field.prop.node);
    if (wide && loose.length > 0) {
      flush();
      out.push(...loose.splice(0));
    }
    if (wide) {
      flush();
      out.push(field);
    } else {
      out.push(field);
      column = (column + 1) % 2;
      due.push(...blocks.filter((b) => b.after === field.prop.key));
      if (column === 0) flush();
    }
  }
  flush();
  out.push(...loose);
  return out;
}

function Note({ text }: { text: string }) {
  return (
    <p className="sf-note">
      <Info aria-hidden="true" size={14} />
      <span>{text}</span>
    </p>
  );
}

/**
 * The fields of an object: its own (required first), then those its conditions bring in under a
 * caption, then a note naming the keys of the value that no field shows (kept as they are).
 */
export function ObjectBody({ node, value, path, emit }: { node: ObjectNode; value: unknown; path: string; emit: (next: Obj) => void }) {
  const obj = isObj(value) ? value : NONE;
  const view = useMemo(() => objectView(node, obj), [node, obj]);
  const latestRef = useLatest(obj);
  const emitRef = useLatest(emit);
  const onChild = useCallback(
    (key: Key, v: unknown) => {
      const next = setKey(latestRef.current, String(key), v);
      latestRef.current = next;
      emitRef.current(next);
    },
    [latestRef, emitRef],
  );
  const many = (keys: string[], one: string, other: string) =>
    t(keys.length === 1 ? one : other, { count: keys.length, keys: keys.join(', ') });

  return (
    <div className="sf-body">
      {view.hint !== undefined && <p className="sf-hint">{view.hint}</p>}
      <div className="sf-grid">
        {arrange(view.fields, view.blocks).map((item) =>
          'prop' in item ? (
            <Fields key={item.prop.key} fields={[item]} value={obj} path={path} onChange={onChild} />
          ) : (
            <CondBlock key={`if:${item.caption}:${item.fields[0]?.prop.key ?? ''}`} block={item} value={obj} path={path} onChange={onChild} />
          ),
        )}
      </div>
      {view.unknown.length > 0 && <Note text={many(view.unknown, 'sf.unknown.one', 'sf.unknown.many')} />}
      {view.hidden.length > 0 && <Note text={many(view.hidden, 'sf.hidden.one', 'sf.hidden.many')} />}
    </div>
  );
}

function summary(node: ObjectNode, value: Obj | undefined): string {
  const set = value ? Object.keys(value) : [];
  if (set.length > 0) return t(set.length === 1 ? 'sf.group.oneSet' : 'sf.group.set', { count: set.length, keys: set.join(', ') });
  const keys = node.props.map((p) => p.key).filter((k) => !k.startsWith('_'));
  const shown = keys.slice(0, SUMMARY_KEYS).join(', ');
  return keys.length > SUMMARY_KEYS ? `${shown}, …` : shown;
}

/**
 * A nested object: a titled group with a collapse toggle. Optional groups with no value start
 * collapsed (their fields are not mounted) and say what they would configure; one that holds an
 * error opens. Emptied, an optional group removes its key.
 */
export function ObjectField({ node, value, name, path, onChange, prop, required }: FieldProps<ObjectNode>) {
  const id = useFieldId(path);
  const error = useFieldError(path);
  const errorBelow = useErrorBelow(path);
  const obj = isObj(value) ? value : undefined;
  const [open, setOpen] = useState(() => required || !isEmpty(obj) || errorBelow);
  const [sawError, setSawError] = useState(errorBelow);
  if (errorBelow !== sawError) {
    setSawError(errorBelow);
    if (errorBelow && !open) setOpen(true);
  }
  const latestRef = useLatest({ name, onChange, required });
  const emit = useCallback(
    (next: Obj) => {
      const { name: key, onChange: change, required: needed } = latestRef.current;
      change(key, isEmpty(next) && !needed ? undefined : next);
    },
    [latestRef],
  );

  const bodyId = `${id}-body`;
  const key = prop?.key ?? String(name);
  return (
    <section className={open ? 'sf-group sf-group--open' : 'sf-group'} aria-labelledby={`${id}-toggle`}>
      <div className="sf-group__head">
        <button
          type="button"
          id={`${id}-toggle`}
          className="sf-group__toggle"
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronRight className="sf-group__chevron" aria-hidden="true" size={15} />
          <FieldLabel name={key} title={prop?.title} />
          {required && <RequiredMark />}
        </button>
        {!open && <span className="sf-group__summary">{summary(node, obj)}</span>}
      </div>
      {prop?.description !== undefined && <p className="sf-group__help">{prop.description}</p>}
      {error !== undefined && <ErrorLine message={error} />}
      {open && (
        <div className="sf-group__body" id={bodyId}>
          <ObjectBody node={node} value={obj} path={path} emit={emit} />
        </div>
      )}
    </section>
  );
}
