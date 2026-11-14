// The node list: a row per node (host, port, weight, priority, and the share of requests its weight
// gives it), plus an empty row at the end to type a new node into or paste `host:port` lines. Rows
// are keyed by position, so the new-node row and the node it becomes are one row: the host field
// keeps focus while the node appears. Locked, it is a plain table.
import { Copy, X } from 'lucide-react';
import { useState, type ClipboardEvent } from 'react';
import { isObj } from '../api/sanitize';
import { issueAt } from '../editor/issues';
import { t } from '../i18n';
import { Button, Input, NumberInput, useLocked, type InputProps } from '../ui';
import type { SectionProps } from './values';
import { addNodes, duplicateNode, isNodeList, NEW_WEIGHT, parseNodeList, pasteNodes, removeNode, rowsOf, setNodeField, sharesOf, type NodeRow, type Share } from './nodes';

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

/**
 * A host field writing on every keystroke. JavaScript lists an object's all-digit keys first, so in
 * a map without a port such an address ("1", "10" on the way to "10.0.0.1") would jump to the top
 * of the list under the cursor: `hold` keeps that text here, unwritten, until it is more than digits.
 */
function HostInput({ hold, value, onCommit, ...rest }: { hold: boolean; value: string; onCommit: (host: string) => void } & Omit<InputProps, 'value' | 'onChange'>) {
  const [held, setHeld] = useState<string>();
  return (
    <Input
      {...rest}
      mono
      autoComplete="off"
      value={held ?? value}
      onChange={(e) => {
        const text = e.target.value;
        if (hold && /^\d+$/.test(text)) setHeld(text);
        else {
          setHeld(undefined);
          onCommit(text);
        }
      }}
      onBlur={() => setHeld(undefined)}
    />
  );
}

export function NodesTable({ value, onChange, issues }: SectionProps) {
  const locked = useLocked();
  const rows = rowsOf(value.nodes);
  const shares = sharesOf(rows, typeof value.type === 'string' ? value.type : undefined);
  if (locked) return <LockedNodes rows={rows} shares={shares} />;

  const map = isObj(value.nodes);
  const issue = (i: number, field: string) => issueAt(issues, `nodes.${i}.${field}`);
  /** Text pasted into a host field that reads as addresses becomes nodes (at `index`, or added). */
  const paste = (index: number | undefined) => (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    const pasted = isNodeList(text) ? parseNodeList(text) : [];
    if (pasted.length === 0) return;
    e.preventDefault();
    onChange(index === undefined ? addNodes(value, pasted.map((row) => ({ ...row, weight: NEW_WEIGHT }))) : pasteNodes(value, index, pasted));
  };

  const nodeRow = (row: NodeRow, i: number) => {
    const n = i + 1;
    return (
      <tr key={i}>
        <td className="up-table__host">
          <HostInput
            aria-label={t('up.nodes.hostN', { n })}
            hold={map && row.port === undefined}
            value={row.host ?? ''}
            error={issue(i, 'host')}
            onCommit={(host) => onChange(setNodeField(value, i, 'host', host))}
            onPaste={paste(i)}
          />
        </td>
        <td className="up-table__num">
          <NumberInput
            aria-label={t('up.nodes.portN', { n })}
            mono
            integer
            min={1}
            max={65535}
            value={row.port}
            error={issue(i, 'port')}
            onChange={(v) => onChange(setNodeField(value, i, 'port', v))}
          />
        </td>
        <td className="up-table__num">
          <NumberInput
            aria-label={t('up.nodes.weightN', { n })}
            integer
            min={0}
            value={row.weight}
            error={issue(i, 'weight')}
            onChange={(v) => onChange(setNodeField(value, i, 'weight', v))}
          />
        </td>
        <td className="up-table__num">
          <NumberInput
            aria-label={t('up.nodes.priorityN', { n })}
            integer
            placeholder="0"
            value={row.priority}
            error={issue(i, 'priority')}
            onChange={(v) => onChange(setNodeField(value, i, 'priority', v))}
          />
        </td>
        {shares && (
          <td className="up-table__share">
            <ShareCell share={shares[i]} />
          </td>
        )}
        <td className="up-table__actions">
          <Button variant="ghost" size="sm" icon={<Copy size={14} />} aria-label={t('up.nodes.duplicateN', { n })} onClick={() => onChange(duplicateNode(value, i))} />
          <Button variant="ghost" size="sm" icon={<X size={15} />} aria-label={t('up.nodes.removeN', { n })} onClick={() => onChange(removeNode(value, i))} />
        </td>
      </tr>
    );
  };

  // Keyed by position in one list with the node rows: typing here turns this row into node n+1 in
  // place, so the field keeps focus. It spans host, port and weight; the cells after stay empty.
  const newRow = (
    <tr key={rows.length} className="up-table__new">
      <td className="up-table__host" colSpan={3}>
        <HostInput
          aria-label={t('up.nodes.new')}
          hold={map}
          value=""
          placeholder={t('up.nodes.newPlaceholder')}
          onCommit={(host) => host !== '' && onChange(addNodes(value, [{ host, weight: NEW_WEIGHT }]))}
          onPaste={paste(undefined)}
        />
      </td>
      <td colSpan={shares ? 3 : 2} />
    </tr>
  );

  return (
    <table className="up-table">
      <Head priority shares={shares !== undefined} actions />
      <tbody>{[...rows.map(nodeRow), newRow]}</tbody>
    </table>
  );
}
