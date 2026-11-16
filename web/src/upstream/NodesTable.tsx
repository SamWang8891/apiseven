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
import { deepEqual } from '../editor/draft';
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
  parseAddr,
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
 * What a map row (or "Add a node") holds that the map can't take: the host field's text exactly as
 * typed, and the port; `as`, the address an explicit commit (Enter, "Move <port> to Port", a paste) read
 * it as, when that moved a port off the text.
 */
interface Held extends Address {
  as?: Address;
}

/** The address a hold is judged as. */
const judged = (h: Held): Address => h.as ?? h;

/** `typed` as an explicit commit reads it (a port its host holds moved to its port), the split kept on the hold. */
function commitOf(typed: Address): Held {
  const as = committed(typed);
  return as === typed ? typed : { ...typed, as };
}

/** The addresses in pasted text, as pasted (separated by line breaks, commas or spaces). */
const pastedTexts = (text: string): string[] => text.split(/[\s,]+/).filter(Boolean);

/**
 * The editing table. Typing writes at once whenever the text is something the list can hold: any host
 * in an array; in a map, an address that is a valid key and that no other row has. Text a map can't
 * hold is held in the row's fields exactly as typed, flagged with why and what to do, and Save is refused
 * naming the node: an address another row has (the row goes back to its address from before the edit, a
 * row this edit added back to "Add a node"; the user changes it or keeps both, which stores an array); an
 * all-digit host without a port (JavaScript would move an integer key to the top of the map under the
 * cursor); a host with a stray colon (not an IPv6 address); a held address whose clash another row's edit
 * resolved. Leaving a field writes nothing and never splits or rewrites what it shows. Enter is the
 * explicit commit: in a host holding a port it moves the port to Port, in a held map row it takes what
 * the row holds (an all-digit host as the host name), in "Add a node" it adds the node; "Move <port> to
 * Port" and a paste do what Enter does. A result another row has is not written: the field stays as
 * typed, held as a duplicate. A change that turns the map into an array (a priority other than 0, "Keep
 * both") ends no other row's hold: what a row holds stays held in the array, which takes it on Enter or
 * when more is typed (a hold ends only when its own text is resolved).
 */
export function NodesTable({ value, onChange, issues }: SectionProps) {
  const locked = useLocked();
  // Both end with the editing session (Save, Discard): nothing held may come back on the next Edit.
  /** What map rows (or the new-node field) hold that the map can't take, by row id. */
  const [held, setHeld] = useEditingState<Record<number, Held>>({});
  const [skipped, setSkipped] = useEditingState<string[]>([]);
  /**
   * A map row's host as the user typed it, where its key reads it otherwise (an IPv6 address, bracketed
   * in the key): shown while the row's key is still that one, until the editing session ends.
   */
  const [typedAs, setTypedAs] = useEditingState<Record<number, { text: string; key: string }>>({});
  /**
   * Each map row's address before the edit in progress, by row id ('new' for a row this edit added): what
   * a duplicate goes back to. The edit ends when its fields are left with nothing held there.
   */
  const start = useRef<Record<number, Address | 'new'>>({});
  useEffect(() => {
    if (locked) start.current = {};
  }, [locked]);
  const rows = rowsOf(value.nodes);
  const fresh = rows.length;
  /** The rows' ids, then the new-node row's. */
  const [ids, setIds] = useRowIds(rows.length + 1);
  const idOf = (i: number): number => ids[i] ?? -1;
  /**
   * The row that already has the address row `i` holds (computed from the rows now, so it follows
   * removals); -1 if none, and always in an array, which holds one address twice.
   */
  const otherOf = (i: number): number => {
    const h = held[idOf(i)];
    if (!h || !isObj(value.nodes)) return -1;
    const at = judged(h);
    // A host with a stray colon is no address yet: nothing can have it.
    if (strayColon(at.host)) return -1;
    const key = addrOf(at.host, at.port);
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
            const at = judged(h);
            // Text with a stray colon is named as typed (it is no address the map could hold).
            const addr = strayColon(at.host) ? h.host : addrOf(at.host, at.port);
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
  const hold = (i: number, h: Held | undefined) => {
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

  /**
   * Map row `i` at the address `h` is judged as: the draft after it. Refused, the row holds `h` (its text
   * as typed); a duplicate goes back to the row's address from before the edit (a row this edit added,
   * back to "Add a node"), so the address another row has is never written. `commitDigits`: an explicit
   * commit, which takes an all-digit host.
   */
  function placeAddress(i: number, h: Held, commitDigits: boolean): { up: Obj; ok: boolean } {
    const id = idOf(i);
    start.current[id] ??= stored(i);
    const address = judged(h);
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
      return { up: edit.up, ok: true };
    }
    hold(i, h);
    if (edit.reason === 'duplicate') {
      const before = start.current[id];
      if (before === 'new') {
        // A node this edit added goes back to being the new-node row, which shows what it holds.
        setIds((prev) => [...withoutId(prev.slice(0, -1), i), id]);
        return { up: removeNode(value, i), ok: false };
      }
      if (before) {
        const back = setMapAddress(value, i, before, { commitDigits: true });
        if (back.ok && !deepEqual(back.up.nodes, value.nodes)) return { up: back.up, ok: false };
      }
    }
    return { up: value, ok: false };
  }

  /** A map row's address edited (typed, or committed: `commitDigits`); true when it was written. */
  function editAddress(i: number, h: Held, commitDigits = false): boolean {
    const { up, ok } = placeAddress(i, h, commitDigits);
    if (up !== value) write(up);
    return ok;
  }

  /**
   * Text in the new-node field; true when a node was added. Typed, what the list can hold is added as it
   * is. `commit` (Enter, Move <port> to Port): `host:port` is read as a paste reads it and an all-digit
   * host is taken. A refusal holds the text as typed.
   */
  function editNew(text: string, commit = false): boolean {
    if (text === '') {
      hold(fresh, undefined);
      return false;
    }
    if (!map) {
      // An array takes any host. What the field held (from before the list became an array) ends here;
      // Enter reads `host:port` as a paste reads it.
      const at = commit ? judged(commitOf({ host: text, port: undefined })) : { host: text, port: undefined };
      hold(fresh, undefined);
      appendedFromNew(1);
      write(addNodes(value, [{ host: at.host, port: at.port, weight: NEW_WEIGHT }]).up);
      return true;
    }
    const typed: Address = { host: text, port: undefined };
    const h = commit ? commitOf(typed) : typed;
    const edit = addMapNode(value, judged(h), { commitDigits: commit });
    if (!edit.ok) {
      hold(fresh, h);
      return false;
    }
    hold(fresh, undefined);
    start.current[idOf(fresh)] = 'new';
    appendedFromNew(1);
    write(edit.up);
    return true;
  }

  /**
   * Leaving a map row's fields writes nothing and changes nothing they show. With nothing held there, the
   * edit in progress ends: a duplicate typed later goes back to the address the row has then.
   */
  function leave(i: number) {
    const id = idOf(i);
    if (!held[id]) delete start.current[id];
  }

  /** "Keep both": the list becomes an array with the row at what it holds. Only that row's hold ends; another row's stays. */
  function keep(i: number) {
    const h = held[idOf(i)];
    if (!h) return;
    hold(i, undefined);
    start.current = {};
    if (i === fresh) appendedFromNew(1);
    write(keepBoth(value, i, judged(h)));
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

  /** Host text typed into an array row: written at once (an array takes any host), which ends a hold the row had. */
  function editArrayHost(i: number, text: string) {
    hold(i, undefined);
    write(setNodeField(value, i, 'host', text));
  }

  /**
   * Enter in a row's host field, the explicit commit: a host holding a port (`10.0.0.5:8080`,
   * `[::1]:9000`) does exactly what "Move <port> to Port" does, in either form; a held map row is placed
   * as it is judged (an all-digit host taken as the host name, an address whose clash has gone added);
   * a row still held from before the list became an array takes its host as it is judged, the port its
   * field shows (or the one Enter moved off the text).
   */
  const enterCommits = (i: number) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const h = held[idOf(i)];
    if (portInHost(hostText(i)) !== undefined) movePort(i);
    else if (h && map) editAddress(i, h, true);
    else if (h) {
      const at = judged(h);
      hold(i, undefined);
      write(setNodeField(setNodeField(value, i, 'host', at.host), i, 'port', h.as ? at.port : rows[i]?.port));
    } else return;
    e.preventDefault();
  };

  /** "Move <port> to Port": the port a host holds goes to the node's port, in one change (an array row, a held map row, the new-node field). */
  function movePort(i: number) {
    const text = hostText(i);
    if (i === fresh) {
      editNew(text, true);
      return;
    }
    if (map) {
      editAddress(i, commitOf({ host: text, port: shown(i).port }), true);
      return;
    }
    const split = committed({ host: text, port: rows[i]?.port });
    hold(i, undefined);
    write(setNodeField(setNodeField(value, i, 'host', split.host), i, 'port', split.port));
  }

  /**
   * Text pasted into a host field that reads as addresses becomes nodes, in one change. In an array, the
   * first replaces the node pasted into (or is added) and the rest follow it. In a map, the first is
   * placed as Enter places what is typed, where it was pasted (a refusal holds it there as pasted, a
   * duplicate as a duplicate), and the rest are added at the end, those the list already has named.
   */
  function paste(e: ClipboardEvent<HTMLInputElement>, index: number | undefined) {
    const text = e.clipboardData.getData('text');
    const texts = isNodeList(text) ? pastedTexts(text) : [];
    if (texts.length === 0) return;
    e.preventDefault();
    if (!map) {
      const pasted = texts.map((addr) => parseAddr(addr));
      const result = index === undefined ? addNodes(value, pasted.map((row) => ({ ...row, weight: NEW_WEIGHT }))) : pasteNodes(value, index, pasted);
      const added = rowsOf(result.up.nodes).length - rows.length;
      // Into the new-node row: it becomes the first pasted node. Into a node: the rest right after it.
      if (added > 0) {
        if (index === undefined) appendedFromNew(added);
        else setIds((prev) => withNewIds(prev, index + 1, added));
      }
      if (result.up !== value) onChange(result.up);
      setSkipped(result.skipped);
      return;
    }
    const [first = '', ...rest] = texts;
    let base = value;
    let firstAdded = false;
    if (index === undefined) {
      const h = commitOf({ host: first, port: undefined });
      const edit = addMapNode(value, judged(h), { commitDigits: true });
      if (edit.ok) {
        hold(fresh, undefined);
        start.current[idOf(fresh)] = 'new';
        base = edit.up;
        firstAdded = true;
      } else hold(fresh, h);
    } else {
      base = placeAddress(index, commitOf({ host: first, port: shown(index).port }), true).up;
    }
    const result = addNodes(
      base,
      rest.map((addr) => ({ ...parseAddr(addr), weight: NEW_WEIGHT })),
    );
    const added = rowsOf(result.up.nodes).length - rowsOf(base.nodes).length;
    // The new-node row's id goes to a first node added from it; the rest get new ids before the new-node row.
    if (firstAdded) appendedFromNew(1 + added);
    else if (added > 0) setIds((prev) => withNewIds(prev, prev.length - 1, added));
    if (result.up !== value) onChange(result.up);
    setSkipped(result.skipped);
  }

  /**
   * An array node whose host holds a stray colon: APISIX takes it (the host pattern allows ':' for
   * IPv6, schema_def.lua 57 host_def_pat, 346) but looks the whole text up as a name, so it gets a
   * hint, which disables nothing. A map row can't hold one (it is held: heldMessage).
   */
  const hostHint = (i: number): string | undefined => {
    if (map || i === fresh) return undefined;
    const host = hostText(i);
    const port = portInHost(host);
    return port !== undefined ? t('up.nodes.hostHasPort', { port }) : strayColon(host) ? t('up.nodes.hostColon') : undefined;
  };
  /**
   * Why a map row (or the new-node field) holds what it shows, and what to do, judged from the rows now
   * (a clash another row's edit resolved is judged again): every held field is flagged, so a refused
   * Save has it to focus.
   */
  const heldMessage = (i: number): string | undefined => {
    const h = held[idOf(i)];
    if (!h) return undefined;
    // Held from before the list became an array (a priority, "Keep both"), which can take it: Enter does.
    if (!map) return t('up.nodes.heldNotYet');
    const at = judged(h);
    const other = otherOf(i);
    if (other >= 0) return t('up.nodes.dupOf', { n: other + 1 });
    if (strayColon(at.host)) return t('up.nodes.colonHeld');
    if (at.port === undefined && /^\d+$/.test(at.host)) return t('up.nodes.digitsHeld');
    return t('up.nodes.heldNotYet');
  };
  /** The "Move <port> to Port" action, for a host that holds a port the row can take (in a map, text held for its stray colon). */
  const moveButton = (i: number) => {
    const port = portInHost(hostText(i));
    const h = held[idOf(i)];
    const colonHeld = h !== undefined && h.as === undefined && strayColon(h.host);
    if (port === undefined || (map && !colonHeld) || (!map && i === fresh)) return null;
    return (
      <Button size="sm" className="up-keep" aria-label={t(i === fresh ? 'up.nodes.movePortNew' : 'up.nodes.movePortN', { port, n: i + 1 })} onClick={() => movePort(i)}>
        {t('up.nodes.movePort', { port })}
      </Button>
    );
  };

  /** A held duplicate's button that keeps both. */
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
            value={hostText(i)}
            error={heldMessage(i) ?? issue(i, 'host')}
            help={hostHint(i)}
            onChange={(e) => (map ? editAddress(i, { host: e.target.value, port: address.port }) : editArrayHost(i, e.target.value))}
            onKeyDown={enterCommits(i)}
            onBlur={() => map && leave(i)}
            onPaste={(e) => paste(e, i)}
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
            // A port edit keeps the host as the field shows it (an IPv6 address as typed, not bracketed).
            onChange={(v) => (map ? editAddress(i, { host: hostText(i), port: v }) : onChange(setNodeField(value, i, 'port', v)))}
            onBlur={() => map && leave(i)}
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
              // A priority turns a map into an array; what any row holds stays held, its hold ending only
              // when its own text is resolved (an array takes it on Enter or more typing).
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
          error={heldMessage(fresh)}
          onChange={(e) => editNew(e.target.value)}
          // Enter adds what the field holds, `host:port` read as a paste reads it; leaving it writes nothing.
          onKeyDown={(e) => {
            const text = held[idOf(fresh)]?.host;
            if (e.key !== 'Enter' || text === undefined) return;
            e.preventDefault();
            editNew(text, true);
          }}
          onPaste={(e) => paste(e, undefined)}
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
