// The node list: a row per node (host, port, weight, priority, and the share of requests its weight
// gives it), plus an empty row at the end to type a new node into or paste `host:port` lines. Rows
// are keyed by position, so the new-node row and the node it becomes are one row: the host field
// keeps focus while the node appears. A map-shaped list stays a map through edits (see NodesTable
// and nodes.ts). Locked, it is a plain table.
import { Copy, X } from 'lucide-react';
import { useEffect, useRef, type ClipboardEvent } from 'react';
import { isObj } from '../api/sanitize';
import type { Obj } from '../api/types';
import { issueAt } from '../editor/issues';
import { t } from '../i18n';
import { Button, Input, NumberInput, useEditingState, useLocked, usePending, type InputProps } from '../ui';
import { IssueLine } from './fields';
import { Head, LockedNodes, ShareCell } from './NodeCells';
import {
  addMapNode,
  addNodes,
  addrOf,
  canDuplicate,
  duplicateNode,
  isNodeList,
  keepBoth,
  NEW_WEIGHT,
  parseNodeList,
  pasteNodes,
  removeNode,
  rowsOf,
  setMapAddress,
  setNodeField,
  sharesOf,
  type Address,
  type NodeRow,
} from './nodes';
import type { SectionProps } from './values';

/** `record` with the key `at` removed and the keys after it moved down one (a removed row). */
function afterRemove<T>(record: Record<number, T>, at: number): Record<number, T> {
  const out: Record<number, T> = {};
  for (const [key, v] of Object.entries(record)) {
    const k = Number(key);
    if (k !== at) out[k > at ? k - 1 : k] = v;
  }
  return out;
}

/** `record` with the keys after `at` moved up one (a row inserted after `at`). */
function afterInsert<T>(record: Record<number, T>, at: number): Record<number, T> {
  const out: Record<number, T> = {};
  for (const [key, v] of Object.entries(record)) {
    const k = Number(key);
    out[k > at ? k + 1 : k] = v;
  }
  return out;
}

/** A host field: monospace, no autofill. */
function HostInput(props: Omit<InputProps, 'mono' | 'autoComplete'>) {
  return <Input {...props} mono autoComplete="off" />;
}

/**
 * The editing table. An array is written on every keystroke. A map too, as long as it can take the
 * address: one another row has is held in the row's fields and flagged (the row goes back to its
 * address from before the edit, so nothing half-typed sits next to the flag) until it changes or the
 * user keeps both, which stores an array; an all-digit host without a port is held while typing and
 * written on leaving the field, as JavaScript would move it to the top of the map under the cursor.
 */
export function NodesTable({ value, onChange, issues }: SectionProps) {
  const locked = useLocked();
  // Both end with the editing session (Save, Discard): nothing held may come back on the next Edit.
  /** Addresses typed into map rows (or the new-node field) that the map can't take yet. */
  const [held, setHeld] = useEditingState<Record<number, Address>>({});
  const [skipped, setSkipped] = useEditingState<string[]>([]);
  /** Each map row's address before the edit in progress; 'new' for a row this edit added. */
  const start = useRef<Record<number, Address | 'new'>>({});
  useEffect(() => {
    if (locked) start.current = {};
  }, [locked]);
  const rows = rowsOf(value.nodes);
  const fresh = rows.length;
  /** The row that already has what row `i` holds (computed from the rows now, so it follows removals); -1 if none. */
  const otherOf = (i: number): number => {
    const h = held[i];
    if (!h) return -1;
    const key = addrOf(h.host, h.port);
    return rows.findIndex((row, j) => j !== i && (row.addr ?? addrOf(row.host ?? '', row.port)) === key);
  };
  // What the fields show but the upstream doesn't have yet: Save waits for it (usePending).
  usePending(
    Object.keys(held).length === 0
      ? undefined
      : Object.entries(held)
          .map(([key, h]) => {
            const i = Number(key);
            const node = i === fresh ? t('up.pending.newNode') : t('up.pending.node', { n: i + 1 });
            const addr = addrOf(h.host, h.port);
            return otherOf(i) >= 0 ? t('up.pending.duplicate', { node, addr }) : t('up.pending.unsaved', { node, addr });
          })
          .join('; '),
  );
  const shares = sharesOf(rows, typeof value.type === 'string' ? value.type : undefined);
  if (locked) return <LockedNodes rows={rows} shares={shares} />;

  const map = isObj(value.nodes);
  const issue = (i: number, field: string) => issueAt(issues, `nodes.${i}.${field}`);
  const stored = (i: number): Address => ({ host: rows[i]?.host ?? '', port: rows[i]?.port });
  const shown = (i: number): Address => held[i] ?? stored(i);
  const hold = (i: number, h: Address | undefined) =>
    setHeld((prev) => {
      const next = { ...prev };
      if (h) next[i] = h;
      else delete next[i];
      return next;
    });
  const write = (up: Obj) => {
    setSkipped([]);
    onChange(up);
  };

  /** A map row's address edited; true when it was written. */
  function editAddress(i: number, address: Address, commitDigits = false): boolean {
    start.current[i] ??= stored(i);
    const edit = setMapAddress(value, i, address, { commitDigits });
    if (edit.ok) {
      hold(i, undefined);
      write(edit.up);
      return true;
    }
    hold(i, address);
    if (edit.reason === 'duplicate') {
      const before = start.current[i];
      if (before === 'new') write(removeNode(value, i));
      else if (before) {
        const back = setMapAddress(value, i, before, { commitDigits: true });
        if (back.ok && back.up.nodes !== value.nodes) write(back.up);
      }
    }
    return false;
  }

  /** Text typed into the new-node field; true when a node was added. */
  function editNew(text: string, commitDigits = false): boolean {
    if (text === '') {
      hold(fresh, undefined);
      return false;
    }
    if (!map) {
      write(addNodes(value, [{ host: text, weight: NEW_WEIGHT }]).up);
      return true;
    }
    const edit = addMapNode(value, { host: text, port: undefined }, { commitDigits });
    if (!edit.ok) {
      hold(fresh, { host: text, port: undefined });
      return false;
    }
    hold(fresh, undefined);
    start.current[fresh] = 'new';
    write(edit.up);
    return true;
  }

  /**
   * Leaving a row's address fields: what waits there is written now if the map can take it (an
   * all-digit host, or an address whose other row has gone); a duplicate stays held and flagged.
   */
  function settle(i: number) {
    const h = held[i];
    const done = h ? (i === fresh ? editNew(h.host, true) : editAddress(i, h, true)) : true;
    if (done) delete start.current[i];
  }

  function keep(i: number) {
    const h = held[i];
    if (!h) return;
    setHeld({});
    start.current = {};
    write(keepBoth(value, i, h));
  }

  function remove(i: number) {
    setHeld((prev) => afterRemove(prev, i));
    start.current = afterRemove(start.current, i);
    write(removeNode(value, i));
  }

  function duplicate(i: number) {
    setHeld((prev) => afterInsert(prev, i));
    start.current = afterInsert(start.current, i);
    write(duplicateNode(value, i));
  }

  /** Text pasted into a host field that reads as addresses becomes nodes (at `index`, or added). */
  const paste = (index: number | undefined) => (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    const pasted = isNodeList(text) ? parseNodeList(text) : [];
    if (pasted.length === 0) return;
    e.preventDefault();
    const result = index === undefined ? addNodes(value, pasted.map((row) => ({ ...row, weight: NEW_WEIGHT }))) : pasteNodes(value, index, pasted);
    hold(fresh, undefined);
    if (index !== undefined) hold(index, undefined);
    if (result.up !== value) onChange(result.up);
    setSkipped(result.skipped);
  };

  /** A held duplicate's message on the host field, and the button that keeps both. */
  const duplicateOf = (i: number) => {
    const other = otherOf(i);
    return other < 0 ? undefined : t('up.nodes.dupOf', { n: other + 1 });
  };
  const keepButton = (i: number) =>
    otherOf(i) >= 0 && (
      <Button
        size="sm"
        className="up-keep"
        aria-label={i === fresh ? t('up.nodes.keepBothNew') : t('up.nodes.keepBothN', { n: i + 1 })}
        title={t('up.nodes.keepBothTitle')}
        onClick={() => keep(i)}
      >
        {t('up.nodes.keepBoth')}
      </Button>
    );

  const nodeRow = (row: NodeRow, i: number) => {
    const n = i + 1;
    const address = shown(i);
    const copyable = canDuplicate(value, i);
    return (
      <tr key={i}>
        <td className="up-table__host">
          <HostInput
            aria-label={t('up.nodes.hostN', { n })}
            value={map ? address.host : (row.host ?? '')}
            error={duplicateOf(i) ?? issue(i, 'host')}
            onChange={(e) => (map ? editAddress(i, { host: e.target.value, port: address.port }) : onChange(setNodeField(value, i, 'host', e.target.value)))}
            onBlur={() => map && settle(i)}
            onPaste={paste(i)}
          />
          {keepButton(i)}
        </td>
        <td className="up-table__num">
          <NumberInput
            aria-label={t('up.nodes.portN', { n })}
            mono
            integer
            min={1}
            max={65535}
            value={map ? address.port : row.port}
            error={issue(i, 'port')}
            onChange={(v) => (map ? editAddress(i, { host: address.host, port: v }) : onChange(setNodeField(value, i, 'port', v)))}
            onBlur={() => map && settle(i)}
          />
        </td>
        <td className="up-table__num">
          <NumberInput
            aria-label={t('up.nodes.weightN', { n })}
            integer
            min={0}
            value={row.weight}
            error={issue(i, 'weight')}
            onChange={(v) => write(setNodeField(value, i, 'weight', v))}
          />
        </td>
        <td className="up-table__num">
          <NumberInput
            aria-label={t('up.nodes.priorityN', { n })}
            integer
            placeholder="0"
            value={row.priority}
            error={issue(i, 'priority')}
            onChange={(v) => {
              const next = setNodeField(value, i, 'priority', v);
              if (next === value) return;
              // A priority turned the map into an array: what was held for the map no longer applies.
              if (map && Array.isArray(next.nodes)) {
                setHeld({});
                start.current = {};
              }
              write(next);
            }}
          />
        </td>
        {shares && (
          <td className="up-table__share">
            <ShareCell share={shares[i]} />
          </td>
        )}
        <td className="up-table__actions">
          <Button
            variant="ghost"
            size="sm"
            icon={<Copy size={14} />}
            aria-label={t('up.nodes.duplicateN', { n })}
            title={copyable ? undefined : t('up.nodes.duplicateTaken')}
            disabled={!copyable}
            onClick={() => duplicate(i)}
          />
          <Button variant="ghost" size="sm" icon={<X size={15} />} aria-label={t('up.nodes.removeN', { n })} onClick={() => remove(i)} />
        </td>
      </tr>
    );
  };

  // Keyed by position in one list with the node rows: typing here turns this row into node n+1 in
  // place, so the field keeps focus. It spans host, port and weight; the cells after stay empty.
  const newRow = (
    <tr key={fresh} className="up-table__new">
      <td className="up-table__host" colSpan={3}>
        <HostInput
          aria-label={t('up.nodes.new')}
          value={held[fresh]?.host ?? ''}
          placeholder={t('up.nodes.newPlaceholder')}
          error={duplicateOf(fresh)}
          onChange={(e) => editNew(e.target.value)}
          onBlur={() => map && settle(fresh)}
          onPaste={paste(undefined)}
        />
        {keepButton(fresh)}
      </td>
      <td colSpan={shares ? 3 : 2} />
    </tr>
  );

  return (
    <>
      <table className="up-table">
        <Head priority shares={shares !== undefined} actions />
        <tbody>{[...rows.map(nodeRow), newRow]}</tbody>
      </table>
      {skipped.length > 0 && <IssueLine message={t('up.nodes.skipped', { list: skipped.join(', ') })} />}
    </>
  );
}
