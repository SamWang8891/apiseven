import { ChevronRight, Info } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { Obj } from '../../api/types';
import { t } from '../../i18n';
import { isObj } from '../../schema/refs';
import { PendingScope, refuseHeld, useHeld, type PendingEntry } from '../../ui';
import { isWide, type ObjectNode } from '../analyze';
import { useErrorBelow, useFieldError, useFieldId, useLatest } from '../context';
import { isEmpty, joinPath, objectView, setKey, type Block, type Key, type ObjectView, type Shown } from '../model';
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

/** A condition's block, as React tells it from the others (its key in ObjectBody): a field is remounted when its block's key changes. */
const blockKey = (block: Block): string => `if:${block.caption}:${block.fields[0]?.prop.key ?? ''}`;

/** A field of a block, for what it holds: its block's key and its own. */
const heldKey = (block: string, field: string): string => `${block}\n${field}`;

/** Every field a view shows in a condition's block, by heldKey. */
const blockFields = (view: ObjectView): Set<string> => new Set(view.blocks.flatMap((b) => b.fields.map((f) => heldKey(blockKey(b), f.prop.key))));

function CondBlock({ block, value, path, onChange, track }: {
  block: Block;
  value: Obj;
  path: string;
  onChange: (name: Key, v: unknown) => void;
  /** What each field of the block holds (ObjectBody refuses a change that would hide one that holds). */
  track: (key: string, entries: PendingEntry[]) => void;
}) {
  const own = blockKey(block);
  return (
    <section className="sf-cond" aria-label={block.caption}>
      <p className="sf-cond__caption">{block.caption}</p>
      <div className="sf-grid">
        {block.fields.map((field) => (
          <PendingScope key={field.prop.key} onChange={(entries) => track(heldKey(own, field.prop.key), entries)}>
            <Fields fields={[field]} value={value} path={path} onChange={onChange} />
          </PendingScope>
        ))}
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
 * caption, then a note naming the keys of the value that no field shows (kept as they are). A change
 * that would hide a condition's field holding input it has not emitted (choosing `local` while a
 * redis field holds "-") is refused: a toast names that field and focus goes to it (final wave D2;
 * addendum 9: a control holding input is never hidden but by an explicit discard).
 */
export function ObjectBody({ node, value, path, emit }: { node: ObjectNode; value: unknown; path: string; emit: (next: Obj) => void }) {
  const obj = isObj(value) ? value : NONE;
  const view = useMemo(() => objectView(node, obj), [node, obj]);
  const latestRef = useLatest(obj);
  const emitRef = useLatest(emit);
  const bodyRef = useRef<HTMLDivElement>(null);
  /** What the fields of the conditions' blocks hold, by heldKey (only those that hold anything). */
  const holding = useRef(new Map<string, PendingEntry[]>());
  const track = useCallback((key: string, entries: PendingEntry[]) => {
    if (entries.length > 0) holding.current.set(key, entries);
    else holding.current.delete(key);
  }, []);
  const onChild = useCallback(
    (key: Key, v: unknown) => {
      const next = setKey(latestRef.current, String(key), v);
      if (holding.current.size > 0) {
        // Only fields shown now count (one gone some other way told no one), and of those, any the change hides.
        const now = blockFields(objectView(node, latestRef.current));
        const then = blockFields(objectView(node, next));
        for (const [at, entries] of holding.current) {
          if (!now.has(at)) holding.current.delete(at);
          else if (!then.has(at) && entries[0]) {
            refuseHeld(entries[0], bodyRef.current);
            return;
          }
        }
      }
      latestRef.current = next;
      emitRef.current(next);
    },
    [latestRef, emitRef, node],
  );
  const many = (keys: string[], one: string, other: string) =>
    t(keys.length === 1 ? one : other, { count: keys.length, keys: keys.join(', ') });

  return (
    <div className="sf-body" ref={bodyRef}>
      {view.hint !== undefined && <p className="sf-hint">{view.hint}</p>}
      <div className="sf-grid">
        {arrange(view.fields, view.blocks).map((item) =>
          'prop' in item ? (
            <Fields key={item.prop.key} fields={[item]} value={obj} path={path} onChange={onChild} />
          ) : (
            <CondBlock key={blockKey(item)} block={item} value={obj} path={path} onChange={onChild} track={track} />
          ),
        )}
      </div>
      {view.unknown.length > 0 && <Note text={many(view.unknown, 'sf.unknown.one', 'sf.unknown.many')} />}
      {view.hidden.length > 0 && <Note text={many(view.hidden, 'sf.hidden.one', 'sf.hidden.many')} />}
      {view.undecided.length > 0 && <Note text={many(view.undecided, 'sf.undecided.one', 'sf.undecided.many')} />}
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
 * error opens, and one whose field holds input it has not emitted does not collapse (useHeld).
 * Emptied, an optional group removes its key.
 */
export function ObjectField({ node, value, name, path, onChange, prop, required }: FieldProps<ObjectNode>) {
  const id = useFieldId(path);
  const error = useFieldError(path);
  const errorBelow = useErrorBelow(path);
  const obj = isObj(value) ? value : undefined;
  const [open, setOpen] = useState(() => required || !isEmpty(obj) || errorBelow);
  const [sawError, setSawError] = useState(errorBelow);
  const held = useHeld();
  const bodyRef = useRef<HTMLDivElement>(null);
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
          onClick={() => {
            if (!(open && held.refuse(bodyRef.current))) setOpen((o) => !o);
          }}
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
        <div className="sf-group__body" id={bodyId} ref={bodyRef}>
          <PendingScope onChange={held.track}>
            <ObjectBody node={node} value={obj} path={path} emit={emit} />
          </PendingScope>
        </div>
      )}
    </section>
  );
}
