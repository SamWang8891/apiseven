import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import type { Obj } from '../../api/types';
import { t } from '../../i18n';
import { isObj } from '../../schema/refs';
import { Button, useLocked } from '../../ui';
import type { ArrayNode, Node, ObjectPart } from '../analyze';
import { holdsPrivateKey, isNeverShownName, isSecretName } from '../../schema/secrets';
import { useFieldError, useFieldId, useLatest } from '../context';
import { blankOf, joinPath, type Key } from '../model';
import { ErrorLine, FieldLabel, RequiredMark } from './chrome';
import { useFieldHelp } from './help';
import { NodeField } from './NodeField';
import { ObjectBody } from './ObjectField';
import type { FieldProps } from './types';

type ListNode = Extract<ArrayNode, { kind: 'array-object' }>;

let lastKey = 0;
const freshKeys = (n: number) => Array.from({ length: n }, () => ++lastKey);

/** Stable React keys for the rows, so a moved row keeps its own state (an open group, a draft). */
function useRowKeys(length: number) {
  const [keys, setKeys] = useState(() => freshKeys(length));
  if (keys.length !== length) {
    const next = keys.length < length ? [...keys, ...freshKeys(length - keys.length)] : keys.slice(0, length);
    setKeys(next);
    return { keys: next, setKeys };
  }
  return { keys, setKeys };
}

/** The keys an item's form marks secret (its own fields, those of its conditions and of its object forms). */
function secretKeys(item: Node): Set<string> {
  const keys = new Set<string>();
  const collect = (part: ObjectPart) => {
    for (const p of part.props) if (p.node.kind === 'string' && p.node.secret) keys.add(p.key);
    for (const c of part.conditionals) [c.then, c.else].forEach((x) => x && collect(x));
  };
  if (item.kind === 'object') collect(item);
  if (item.kind === 'variant') item.options.forEach((o) => o.node.kind === 'object' && collect(o.node));
  return keys;
}

/**
 * A short "host=127.0.0.1, port=6379" of a row's first scalar values, for its header; never a secret,
 * never what is never shown: a never-shown name's value, or text holding a PEM private key, stored or
 * typed (Codex final pass, fix round 1, Y1).
 */
function rowSummary(item: unknown, secret: Set<string>): string {
  if (!isObj(item)) return '';
  return Object.entries(item)
    .filter(([k, v]) => (v === null || typeof v !== 'object') && !secret.has(k) && !isSecretName(k) && !isNeverShownName(k) && !holdsPrivateKey(v))
    .slice(0, 3)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(', ');
}

interface RowProps {
  item: Node;
  value: unknown;
  index: number;
  count: number;
  path: string;
  onItem: (index: Key, v: unknown) => void;
  onMove: (index: number, by: -1 | 1) => void;
  onRemove: (index: number) => void;
}

const Row = memo(function Row({ item, value, index, count, path, onItem, onMove, onRemove }: RowProps) {
  const locked = useLocked();
  const error = useFieldError(path);
  const n = index + 1;
  const emitObject = useCallback((next: Obj) => onItem(index, next), [onItem, index]);
  const actions = !locked && (
    <span className="sf-row__actions">
      <Button variant="ghost" size="sm" icon={<ArrowUp size={14} />} aria-label={t('sf.list.up', { n })} disabled={index === 0} onClick={() => onMove(index, -1)} />
      <Button
        variant="ghost"
        size="sm"
        icon={<ArrowDown size={14} />}
        aria-label={t('sf.list.down', { n })}
        disabled={index === count - 1}
        onClick={() => onMove(index, 1)}
      />
      <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} aria-label={t('sf.list.remove', { n })} onClick={() => onRemove(index)} />
    </span>
  );
  const label = t('sf.list.item', { n });
  const secrets = useMemo(() => secretKeys(item), [item]);

  // One-line items (a secret, a PEM) sit in a compact row; objects, maps and variants in a card.
  if (item.kind === 'string') {
    return (
      <div className="sf-row">
        <div className="sf-row__field">
          <NodeField node={item} value={value} name={index} path={path} onChange={onItem} required ariaLabel={label} />
        </div>
        {actions}
      </div>
    );
  }
  return (
    <div className="sf-card">
      <div className="sf-card__head">
        <span className="sf-card__title">
          <span className="sf-card__index">{label}</span>
          <span className="sf-card__summary mono">{rowSummary(value, secrets)}</span>
        </span>
        {actions}
      </div>
      <div className="sf-card__body">
        {error !== undefined && <ErrorLine message={error} />}
        {item.kind === 'object' ? (
          <ObjectBody node={item} value={value} path={path} emit={emitObject} />
        ) : (
          <NodeField node={item} value={value} name={index} path={path} onChange={onItem} required ariaLabel={label} />
        )}
      </div>
    </div>
  );
});

/**
 * An array of objects (or of maps, variants, multi-line or secret strings): one card per item with
 * Move up / Move down / Remove, and Add at the end. Removing the last item deletes the key unless the
 * list is required. Rows are never removed by anything but Remove.
 */
export function ListField({ node, value, name, path, onChange, prop, required, ariaLabel }: FieldProps<ListNode>) {
  const locked = useLocked();
  const id = useFieldId(path);
  const error = useFieldError(path);
  const help = useFieldHelp(prop, node, value);
  const items: unknown[] = Array.isArray(value) ? (value as unknown[]) : [];
  const { keys, setKeys } = useRowKeys(items.length);
  const latestRef = useLatest({ items, keys, name, onChange, required });

  const emit = useCallback(
    (next: unknown[], nextKeys: number[]) => {
      const { name: key, onChange: change, required: needed } = latestRef.current;
      latestRef.current = { ...latestRef.current, items: next, keys: nextKeys };
      setKeys(nextKeys);
      change(key, next.length === 0 && !needed ? undefined : next);
    },
    [latestRef, setKeys],
  );
  const onItem = useCallback(
    (index: Key, v: unknown) => {
      const { items: cur, keys: ks } = latestRef.current;
      const next = [...cur];
      // A row emptied of everything stays a row: only Remove takes it away.
      next[Number(index)] = v === undefined ? blankOf(node.item) ?? null : v;
      emit(next, ks);
    },
    [latestRef, emit, node.item],
  );
  const onMove = useCallback(
    (index: number, by: -1 | 1) => {
      const { items: cur, keys: ks } = latestRef.current;
      const to = index + by;
      if (to < 0 || to >= cur.length) return;
      const swap = <T,>(list: T[]) => {
        const copy = [...list];
        [copy[index], copy[to]] = [copy[to] as T, copy[index] as T];
        return copy;
      };
      emit(swap(cur), swap(ks));
    },
    [latestRef, emit],
  );
  const onRemove = useCallback(
    (index: number) => {
      const { items: cur, keys: ks } = latestRef.current;
      emit(
        cur.filter((_, i) => i !== index),
        ks.filter((_, i) => i !== index),
      );
    },
    [latestRef, emit],
  );
  const add = () => {
    const { items: cur, keys: ks } = latestRef.current;
    emit([...cur, blankOf(node.item)], [...ks, ...freshKeys(1)]);
  };

  const key = prop?.key ?? ariaLabel ?? String(name);
  return (
    <div className="sf-list" role="group" aria-labelledby={`${id}-label`}>
      <div className="sf-list__head">
        {prop ? (
          <span className="sf-list__label" id={`${id}-label`}>
            <FieldLabel name={key} title={prop.title} />
            {required && <RequiredMark />}
          </span>
        ) : (
          // Without a property of its own (a variant's form) the label above already names it.
          <span className="sf-sr-only" id={`${id}-label`}>
            {key}
          </span>
        )}
        {items.length > 0 && <span className="sf-list__count">{t(items.length === 1 ? 'sf.list.one' : 'sf.list.count', { count: items.length })}</span>}
      </div>
      {help !== undefined && <p className="sf-help">{help}</p>}
      {error !== undefined && <ErrorLine message={error} />}
      {items.length > 0 && (
        <div className="sf-list__items">
          {items.map((item, i) => (
            <Row
              key={keys[i] ?? i}
              item={node.item}
              value={item}
              index={i}
              count={items.length}
              path={joinPath(path, i)}
              onItem={onItem}
              onMove={onMove}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}
      {!locked && (
        <div>
          <Button variant="secondary" size="sm" icon={<Plus size={14} />} aria-label={t('sf.list.addTo', { key })} onClick={add}>
            {t('sf.list.add')}
          </Button>
        </div>
      )}
    </div>
  );
}
