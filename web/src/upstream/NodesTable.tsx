// The node list: a row per node (host, port, weight, priority, and the share of requests its weight
// gives it), plus an empty row at the end to type a new node into or paste `host:port` lines. Rows
// are keyed by position, so the new-node row and the node it becomes are one row: the host field
// keeps focus while the node appears. A map-shaped list stays a map through edits (see NodesTable
// and nodes.ts). Locked, it is a plain table.
import { Copy, X } from 'lucide-react';
import { useEffect, useRef, useState, type ClipboardEvent } from 'react';
import { isObj } from '../api/sanitize';
import type { Obj } from '../api/types';
import { issueAt } from '../editor/issues';
import { t } from '../i18n';
import { Button, Input, NumberInput, useLocked, type InputProps } from '../ui';
import { IssueLine } from './fields';
import {
  addMapNode,
  addNodes,
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
  type Share,
} from './nodes';
import type { SectionProps } from './values';

/** `75%`, `<1%` for a sliver, `0%`. */
function percent(share: number): string {
  const pct = Math.round(share * 100);
  return pct === 0 && share > 0 ? '<1%' : `${pct}%`;
}

function ShareCell({ share }: { share: Share }) {
  if (share === undefined) return <span className="up-share up-share--none">{t('ui.empty')}</span>;
  if (share === 'standby') {
    return (
      <span className="up-share up-share--standby" title={t('up.nodes.standbyTitle')}>
        {t('up.nodes.standby')}
      </span>
    );
  }
  const text = percent(share);
  return (
    <span className="up-share" title={t('up.nodes.shareTitle', { share: text })}>
      <span className="up-share__track" aria-hidden="true">
        <span className="up-share__fill" style={{ width: `${Math.min(100, share * 100)}%` }} />
      </span>
      <span className="up-share__pct">{text}</span>
    </span>
  );
}

function Head({ priority, shares, actions }: { priority: boolean; shares: boolean; actions: boolean }) {
  return (
    <thead>
      <tr>
        <th scope="col" className="up-table__host">
          {t('up.nodes.host')}
        </th>
        <th scope="col" className="up-table__num">
          {t('up.nodes.port')}
        </th>
        <th scope="col" className="up-table__num">
          {t('up.nodes.weight')}
        </th>
        {priority && (
          <th scope="col" className="up-table__num">
            {t('up.nodes.priority')}
          </th>
        )}
        {shares && (
          <th scope="col" className="up-table__share">
            {t('up.nodes.share')}
          </th>
        )}
        {actions && (
          <th scope="col" className="up-table__actions">
            <span className="up-sr-only">{t('up.nodes.actions')}</span>
          </th>
        )}
      </tr>
    </thead>
  );
}

/** The table as it reads locked: values only; the priority column only when a node sets one. */
function LockedNodes({ rows, shares }: { rows: NodeRow[]; shares: Share[] | undefined }) {
  if (rows.length === 0) return <p className="up-empty">{t('up.nodes.empty')}</p>;
  const priority = rows.some((row) => row.priority !== undefined);
  return (
    <table className="up-table up-table--locked">
      <Head priority={priority} shares={shares !== undefined} actions={false} />
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            <td className="up-table__host mono">{row.host ?? t('ui.empty')}</td>
            <td className="up-table__num mono">{row.port ?? t('ui.empty')}</td>
            <td className="up-table__num">{row.weight ?? t('ui.empty')}</td>
            {priority && <td className="up-table__num">{row.priority ?? 0}</td>}
            {shares && (
              <td className="up-table__share">
                <ShareCell share={shares[i]} />
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** An address typed into a map row that the map can't take yet; `other` is the row that has it. */
interface Held extends Address {
  other?: number;
}

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
  const [held, setHeld] = useState<Record<number, Held>>({});
  const [skipped, setSkipped] = useState<string[]>([]);
  /** Each map row's address before the edit in progress; 'new' for a row this edit added. */
  const start = useRef<Record<number, Address | 'new'>>({});
  // Locking (Save, Discard) ends the editing: nothing held may come back on the next Edit.
  if (locked && (Object.keys(held).length > 0 || skipped.length > 0)) {
    setHeld({});
    setSkipped([]);
  }
  useEffect(() => {
    if (locked) start.current = {};
  }, [locked]);
  const rows = rowsOf(value.nodes);
  const shares = sharesOf(rows, typeof value.type === 'string' ? value.type : undefined);
  if (locked) return <LockedNodes rows={rows} shares={shares} />;

  const map = isObj(value.nodes);
  const fresh = rows.length;
  const issue = (i: number, field: string) => issueAt(issues, `nodes.${i}.${field}`);
  const stored = (i: number): Address => ({ host: rows[i]?.host ?? '', port: rows[i]?.port });
  const shown = (i: number): Address => held[i] ?? stored(i);
  const hold = (i: number, h: Held | undefined) =>
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
    hold(i, edit.reason === 'duplicate' ? { ...address, other: edit.other } : address);
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
      hold(fresh, { host: text, port: undefined, other: edit.reason === 'duplicate' ? edit.other : undefined });
      return false;
    }
    hold(fresh, undefined);
    start.current[fresh] = 'new';
    write(edit.up);
    return true;
  }

  /** Leaving a row's address fields: an all-digit host waiting there is written now. */
  function settle(i: number) {
    const h = held[i];
    const done = h && h.other === undefined ? (i === fresh ? editNew(h.host, true) : editAddress(i, h, true)) : !h;
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
    const other = held[i]?.other;
    return other === undefined ? undefined : t('up.nodes.dupOf', { n: other + 1 });
  };
  const keepButton = (i: number) =>
    held[i]?.other !== undefined && (
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
