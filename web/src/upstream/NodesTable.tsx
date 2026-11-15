// The node list: a row per node (host, port, weight, priority, and the share of requests its weight
// gives it), plus an empty row at the end to type a new node into or paste `host:port` lines. Rows
// are keyed by ids that follow them through removals, copies and pastes (rowIds.ts), so what a
// row's fields hold stays on that row. The new-node row hands its id to the node it becomes, so the
// host field keeps focus while the node appears. A map-shaped list stays a map through edits (see
// NodesTable and nodes.ts). Locked, it is a plain table.
import { Copy, X } from 'lucide-react';
import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { isObj } from '../api/sanitize';
import type { Obj } from '../api/types';
import { issueAt } from '../editor/issues';
import { t } from '../i18n';
import { Button, Input, NumberInput, useEditingState, useLocked, usePending, type InputProps } from '../ui';
import { IssueLine } from './fields';
import { freshIds, useRowIds, withNewIds, withoutId } from './rowIds';
import { Head, LockedNodes, ShareCell } from './NodeCells';
import {
  addMapNode,
  addNodes,
  addrOf,
  canDuplicate,
  committed,
  duplicateNode,
  isIpv6,
  isNodeList,
  keepBoth,
  NEW_WEIGHT,
  parseNodeList,
  pasteNodes,
  portInHost,
  removeNode,
  rowsOf,
  setMapAddress,
  setNodeField,
  sharesOf,
  strayColon,
  type Address,
  type NodeRow,
} from './nodes';
import type { SectionProps } from './values';

/** `record` without the key `id` (a row that went). */
function without<T>(record: Record<number, T>, id: number | undefined): Record<number, T> {
  if (id === undefined || !(id in record)) return record;
  const out = { ...record };
  delete out[id];
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
 * written on leaving the field, as JavaScript would move it to the top of the map under the cursor; a
 * host with a stray colon (not an IPv6 address) is held until it changes or its port is moved.
 * Leaving a host field never splits or rewrites it: a host holding a port gets a hint and a "Move
 * <port> to Port" action; "Add a node" splits `host:port` on Enter, as a paste does.
 */
export function NodesTable({ value, onChange, issues }: SectionProps) {
  const locked = useLocked();
  // Both end with the editing session (Save, Discard): nothing held may come back on the next Edit.
  /** Addresses typed into map rows (or the new-node field) that the map can't take yet, by row id. */
  const [held, setHeld] = useEditingState<Record<number, Address>>({});
  const [skipped, setSkipped] = useEditingState<string[]>([]);
  /**
   * A map row's host as the user typed it, where its key reads it otherwise (an IPv6 address, bracketed
   * in the key): shown while the row's key is still that one, until the editing session ends.
   */
  const [typedAs, setTypedAs] = useEditingState<Record<number, { text: string; key: string }>>({});
  /** Each map row's address before the edit in progress, by row id; 'new' for a row this edit added. */
  const start = useRef<Record<number, Address | 'new'>>({});
  useEffect(() => {
    if (locked) start.current = {};
  }, [locked]);
  const rows = rowsOf(value.nodes);
  const fresh = rows.length;
  /** The rows' ids, then the new-node row's. */
  const [ids, setIds] = useRowIds(rows.length + 1);
  const idOf = (i: number): number => ids[i] ?? -1;
  /** The row that already has what row `i` holds (computed from the rows now, so it follows removals); -1 if none. */
  const otherOf = (i: number): number => {
    const h = held[idOf(i)];
    // A host with a stray colon is no address yet: nothing can have it.
    if (!h || strayColon(h.host)) return -1;
    const key = addrOf(h.host, h.port);
    return rows.findIndex((row, j) => j !== i && (row.addr ?? addrOf(row.host ?? '', row.port)) === key);
  };
  // What the fields show but the upstream doesn't have yet: Save waits for it (usePending).
  const heldRows = ids.flatMap((id, i) => {
    const h = held[id];
    return h ? [{ i, h }] : [];
  });
  usePending(
    heldRows.length === 0
      ? undefined
      : heldRows
          .map(({ i, h }) => {
            const node = i === fresh ? t('up.pending.newNode') : t('up.pending.node', { n: i + 1 });
            // Text with a stray colon is named as typed (it is no address the map could hold).
            const addr = strayColon(h.host) ? h.host : addrOf(h.host, h.port);
            return otherOf(i) >= 0 ? t('up.pending.duplicate', { node, addr }) : t('up.pending.unsaved', { node, addr });
          })
          .join('; '),
  );
  const shares = sharesOf(rows, typeof value.type === 'string' ? value.type : undefined);
  if (locked) return <LockedNodes rows={rows} shares={shares} />;

  const map = isObj(value.nodes);
  const issue = (i: number, field: string) => issueAt(issues, `nodes.${i}.${field}`);
  const stored = (i: number): Address => ({ host: rows[i]?.host ?? '', port: rows[i]?.port });
  const shown = (i: number): Address => held[idOf(i)] ?? stored(i);
  const hold = (i: number, h: Address | undefined) => {
    const id = idOf(i);
    setHeld((prev) => {
      const next = { ...prev };
      if (h) next[id] = h;
      else delete next[id];
      return next;
    });
  };
  /** After `rows` became `count` rows by nodes added at the end: the new-node row's id goes to the first of them. */
  const appendedFromNew = (count: number) => setIds((prev) => [...prev, ...freshIds(count)]);
  const write = (up: Obj) => {
    setSkipped([]);
    onChange(up);
  };

  /** A map row's address edited; true when it was written. */
  function editAddress(i: number, address: Address, commitDigits = false): boolean {
    const id = idOf(i);
    start.current[id] ??= stored(i);
    const edit = setMapAddress(value, i, address, { commitDigits });
    if (edit.ok) {
      hold(i, undefined);
      // An IPv6 host is bracketed in its key: the field keeps showing it as typed.
      const key = addrOf(address.host, address.port);
      setTypedAs((prev) => {
        const next = without(prev, id);
        if (isIpv6(address.host) && !address.host.startsWith('[')) next[id] = { text: address.host, key };
        return next;
      });
      write(edit.up);
      return true;
    }
    hold(i, address);
    if (edit.reason === 'duplicate') {
      const before = start.current[id];
      if (before === 'new') {
        // A node this edit added goes back to being the new-node row, which shows what it holds.
        setIds((prev) => [...withoutId(prev.slice(0, -1), i), id]);
        write(removeNode(value, i));
      } else if (before) {
        const back = setMapAddress(value, i, before, { commitDigits: true });
        if (back.ok && back.up.nodes !== value.nodes) write(back.up);
      }
    }
    return false;
  }

  /**
   * Text typed into the new-node field; true when a node was added. `split` (Enter, or Move <port> to
   * Port): `host:port` is read as a paste reads it; never on leaving the field.
   */
  function editNew(text: string, commitDigits = false, split = false): boolean {
    if (text === '') {
      hold(fresh, undefined);
      return false;
    }
    if (!map) {
      appendedFromNew(1);
      write(addNodes(value, [{ host: text, weight: NEW_WEIGHT }]).up);
      return true;
    }
    const typed = { host: text, port: undefined };
    const edit = addMapNode(value, split ? committed(typed) : typed, { commitDigits });
    if (!edit.ok) {
      hold(fresh, { host: text, port: undefined });
      return false;
    }
    hold(fresh, undefined);
    start.current[idOf(fresh)] = 'new';
    appendedFromNew(1);
    write(edit.up);
    return true;
  }

  /**
   * Leaving a row's address fields: what waits there is written now if the map can take it as it is
   * shown (an all-digit host, or an address whose other row has gone); a duplicate, and a host with a
   * stray colon, stay held and flagged. Leaving never splits or rewrites what the field shows.
   */
  function settle(i: number) {
    const id = idOf(i);
    const h = held[id];
    // The one write leaving a field makes: an all-digit map host, held while typed (`10` may be the start
    // of `10.0.0.5`, and JavaScript would move an integer key to the top of the map under the cursor). It
    // writes exactly the host and port the fields show, so nothing a save sends differs from the screen.
    const done = h ? (i === fresh ? editNew(h.host, true) : editAddress(i, h, true)) : true;
    if (done) delete start.current[id];
  }

  function keep(i: number) {
    const h = held[idOf(i)];
    if (!h) return;
    setHeld({});
    start.current = {};
    if (i === fresh) appendedFromNew(1);
    write(keepBoth(value, i, h));
  }

  /** Removing a row discards what it held, with it. */
  function remove(i: number) {
    const id = idOf(i);
    setHeld((prev) => without(prev, id));
    start.current = without(start.current, id);
    setIds((prev) => withoutId(prev, i));
    write(removeNode(value, i));
  }

  function duplicate(i: number) {
    const next = duplicateNode(value, i);
    if (next === value) return;
    setIds((prev) => withNewIds(prev, i + 1, 1));
    write(next);
  }

  /** The host row `i` shows (held text, a map host as typed, else the node's), and the port it holds, if any. */
  const hostText = (i: number): string => {
    const id = idOf(i);
    const h = held[id];
    if (h) return h.host;
    if (i === fresh) return '';
    const as = typedAs[id];
    return map && as && rows[i]?.addr === as.key ? as.text : (rows[i]?.host ?? '');
  };

  /**
   * Enter in a host field whose text holds a port (`10.0.0.5:8080`, `[::1]:9000`): the commit, doing
   * exactly what "Move <port> to Port" does, in either form, for a row just added or a stored one.
   */
  const enterMoves = (i: number) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || portInHost(hostText(i)) === undefined) return;
    e.preventDefault();
    movePort(i);
  };

  /** "Move <port> to Port": the port a host holds goes to the node's port, in one change (an array row, a held map row, the new-node field). */
  function movePort(i: number) {
    const text = hostText(i);
    if (i === fresh) {
      editNew(text, true, true);
      return;
    }
    if (map) {
      editAddress(i, committed({ host: text, port: shown(i).port }), true);
      return;
    }
    const split = committed({ host: text, port: rows[i]?.port });
    write(setNodeField(setNodeField(value, i, 'host', split.host), i, 'port', split.port));
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
    const added = rowsOf(result.up.nodes).length - rows.length;
    if (added > 0) {
      // Into the new-node row: it becomes the first pasted node. Into a node: an array takes the
      // rest right after it, a map at the end.
      if (index === undefined) appendedFromNew(added);
      else setIds((prev) => withNewIds(prev, map ? fresh : index + 1, added));
    }
    if (result.up !== value) onChange(result.up);
    setSkipped(result.skipped);
  };

  /**
   * An array node whose host holds a stray colon: APISIX takes it (the host pattern allows ':' for
   * IPv6, schema_def.lua 57 host_def_pat, 346) but looks the whole text up as a name, so it gets a
   * hint, which disables nothing. A map row can't hold one (it is held: colonHeld).
   */
  const hostHint = (i: number): string | undefined => {
    if (map || i === fresh) return undefined;
    const host = hostText(i);
    const port = portInHost(host);
    return port !== undefined ? t('up.nodes.hostHasPort', { port }) : strayColon(host) ? t('up.nodes.hostColon') : undefined;
  };
  /** A map row (or the new-node field) holding a host with a stray colon: why it is not in the list. */
  const colonHeld = (i: number): string | undefined => {
    const h = held[idOf(i)];
    return h && strayColon(h.host) ? t('up.nodes.colonHeld') : undefined;
  };
  /** The "Move <port> to Port" action, for a host that holds a port the row can take. */
  const moveButton = (i: number) => {
    const port = portInHost(hostText(i));
    if (port === undefined || (map && !colonHeld(i)) || (!map && i === fresh)) return null;
    return (
      <Button size="sm" className="up-keep" aria-label={t(i === fresh ? 'up.nodes.movePortNew' : 'up.nodes.movePortN', { port, n: i + 1 })} onClick={() => movePort(i)}>
        {t('up.nodes.movePort', { port })}
      </Button>
    );
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
      <tr key={idOf(i)}>
        <td className="up-table__host">
          <HostInput
            aria-label={t('up.nodes.hostN', { n })}
            value={map ? hostText(i) : (row.host ?? '')}
            error={duplicateOf(i) ?? issue(i, 'host') ?? colonHeld(i)}
            help={hostHint(i)}
            onChange={(e) => (map ? editAddress(i, { host: e.target.value, port: address.port }) : onChange(setNodeField(value, i, 'host', e.target.value)))}
            onKeyDown={enterMoves(i)}
            onBlur={() => map && settle(i)}
            onPaste={paste(i)}
          />
          {keepButton(i)}
          {moveButton(i)}
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

  // Keyed in one list with the node rows: typing here turns this row (its id) into node n+1 in
  // place, so the field keeps focus. It spans host, port and weight; the cells after stay empty.
  const newRow = (
    <tr key={idOf(fresh)} className="up-table__new">
      <td className="up-table__host" colSpan={3}>
        <HostInput
          aria-label={t('up.nodes.new')}
          value={held[idOf(fresh)]?.host ?? ''}
          placeholder={t('up.nodes.newPlaceholder')}
          error={duplicateOf(fresh) ?? colonHeld(fresh)}
          onChange={(e) => editNew(e.target.value)}
          // Enter adds what the field holds, `host:port` read as a paste reads it.
          onKeyDown={(e) => {
            const text = held[idOf(fresh)]?.host;
            if (e.key !== 'Enter' || text === undefined) return;
            e.preventDefault();
            editNew(text, true, true);
          }}
          onBlur={() => map && settle(fresh)}
          onPaste={paste(undefined)}
        />
        {keepButton(fresh)}
        {moveButton(fresh)}
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
