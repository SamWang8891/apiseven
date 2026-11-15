// Cells for the resource lists, shared by every kind that shows the same kind of value: hosts,
// methods, plugins, upstreams, references, labels, times, ids. Columns compute the values (see
// routes/columns.tsx) and hand them in; these only present them. Each cell's first line is text (or
// a chip whose first item is text), so it shares the row's baseline (table.css).
import { Copy } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { Item, Kind, Parent } from '../api/types';
import { t } from '../i18n';
import { pathFor } from '../router/paths';
import { Empty, Lines, NameCell } from '../table/cells';
import { formatAbsolute, formatRelative } from '../table/format';
import { Badge, toast, Tooltip } from '../ui';
import { nameOfValue, type CtxKind, type Reference, type RefTarget, type UpstreamSummary } from './resolve';
import './cells.css';

/** Chips shown before `+N`. */
const SHOWN_CHIPS = 4;

/** The object's name linking to its editor, its description underneath when it has a name of its own; `mono` for a name that is an id (a username). */
export function NameDescCell({ kind, item, parent, mono }: { kind: Kind; item: Item; parent?: Parent; mono?: boolean }) {
  const name = nameOfValue(item.value) ?? item.id;
  const { desc } = item.value;
  return (
    <>
      <NameCell kind={kind} item={item} value={name} parent={parent} mono={mono} />
      {typeof desc === 'string' && desc !== '' && desc !== name && (
        <span className="cell-sub" title={desc}>
          {desc}
        </span>
      )}
    </>
  );
}

/** The accent tag of a value a route takes from its service. */
export function ViaService() {
  return <Badge tone="accent">{t('cell.viaService')}</Badge>;
}

/** Hosts one per line in monospace, tagged when they come from the service; "any host" with none. */
export function HostsCell({ hosts, viaService }: { hosts: string[]; viaService?: boolean }) {
  if (hosts.length === 0) return <span className="cell-muted">{t('cell.anyHost')}</span>;
  return (
    <>
      <Lines lines={hosts} mono />
      {viaService && (
        <span className="cell-under">
          <ViaService />
        </span>
      )}
    </>
  );
}

/** Up to four chips, then `+N` with every item in a tooltip. */
function ChipList({ chips, all }: { chips: ReactNode[]; all: ReactNode[] }) {
  const hidden = chips.length - SHOWN_CHIPS;
  return (
    <span className="cell-chips">
      {chips.slice(0, SHOWN_CHIPS)}
      {hidden > 0 && (
        <Tooltip content={<span className="cell-tip-list">{all}</span>}>
          <button type="button" className="tbl-more">
            {t('cell.more', { count: hidden })}
          </button>
        </Tooltip>
      )}
    </span>
  );
}

/** HTTP methods as chips; `ANY` (no restriction) quieter than a real list. */
export function MethodChips({ methods }: { methods: string[] }) {
  return (
    <span className="cell-chips">
      {methods.map((method) => (
        <span key={method} className={method === 'ANY' ? 'cell-chip cell-method cell-method--any' : 'cell-chip cell-method'}>
          {method}
        </span>
      ))}
    </span>
  );
}

export interface PluginChip {
  name: string;
  /** `_meta.disable`: configured but not running. */
  disabled?: boolean;
  /** Where an inherited plugin comes from ("From service web"); unset for the object's own. */
  from?: string;
}

/**
 * One plugin chip. A name wider than the column ends in an ellipsis; the full name is in the chip's
 * title, or, for an inherited plugin, in its tooltip above where it comes from.
 */
function pluginChip(plugin: PluginChip): ReactNode {
  const cls = ['cell-chip', 'cell-plugin', plugin.from && 'cell-plugin--inherited', plugin.disabled && 'cell-plugin--off'];
  const chip = (
    <span key={plugin.name} className={cls.filter(Boolean).join(' ')} title={plugin.from ? undefined : plugin.name}>
      <span className="cell-chip__text">{plugin.name}</span>
      {plugin.disabled && <span className="cell-plugin__off">{t('cell.plugin.off')}</span>}
      {plugin.from && <span className="ui-sr-only"> ({plugin.from})</span>}
    </span>
  );
  return plugin.from ? (
    <Tooltip
      key={plugin.name}
      content={
        <span className="cell-tip-list">
          <span>{plugin.name}</span>
          <span>{plugin.from}</span>
        </span>
      }
    >
      {chip}
    </Tooltip>
  ) : (
    chip
  );
}

/** One line per plugin for the `+N` tooltip, with where it comes from and whether it is off. */
function pluginLine(plugin: PluginChip): ReactNode {
  const notes = [plugin.disabled && t('cell.plugin.off'), plugin.from].filter(Boolean).join(', ');
  return (
    <span key={plugin.name}>
      {plugin.name}
      {notes && <span className="cell-tip-note"> ({notes})</span>}
    </span>
  );
}

/**
 * Plugin chips: the first four, then `+N` with the whole list in a tooltip. Inherited plugins have
 * a dashed outline and say where from (tooltip, and to screen readers); a disabled one says `off`.
 */
export function PluginChips({ plugins }: { plugins: PluginChip[] }) {
  if (plugins.length === 0) return <Empty />;
  return <ChipList chips={plugins.map(pluginChip)} all={plugins.map(pluginLine)} />;
}

/** `key:value` chips, the key quieter than the value; a long pair ends in an ellipsis, in full in the title. */
export function LabelChips({ pairs }: { pairs: [string, string][] }) {
  if (pairs.length === 0) return <Empty />;
  const chip = ([key, value]: [string, string]) => (
    <span key={key} className="cell-chip cell-label" title={`${key}:${value}`}>
      <span className="cell-chip__text">
        <span className="cell-label__key">{key}:</span>
        {value}
      </span>
    </span>
  );
  return <ChipList chips={pairs.map(chip)} all={pairs.map(([key, value]) => <span key={key}>{`${key}:${value}`}</span>)} />;
}

/** A dangling reference: the id the field holds, as a danger badge. */
export function MissingRef({ kind, id }: { kind: CtxKind; id: string }) {
  return <Badge tone="danger">{t(`cell.missing.${kind}`, { id })}</Badge>;
}

/**
 * A link to the referenced object by its name (else id), a danger badge when it is gone, — when unset.
 * While the list it is looked up in is `loading`, an id it doesn't hold yet shows as it is.
 */
export function RefCell({ kind, target, loading }: { kind: CtxKind; target: RefTarget | undefined; loading?: boolean }) {
  if (!target) return <Empty />;
  if (!target.item && loading) {
    return (
      <span className="tbl-line mono" title={target.id}>
        {target.id}
      </span>
    );
  }
  if (!target.item) return <MissingRef kind={kind} id={target.id} />;
  const name = nameOfValue(target.item.value) ?? target.id;
  return (
    <Link className="cell-link" to={pathFor(kind, target.id)} title={name}>
      {name}
    </Link>
  );
}

/** True when the summary's label is its node list (rather than a name or a discovery service). */
function labelIsNodes({ label, nodes }: UpstreamSummary): boolean {
  const [first] = nodes;
  return first !== undefined && label === (nodes.length > 1 ? `${first} +${nodes.length - 1}` : first);
}

/**
 * Where an object proxies to: a link to the upstream, or to the service it inherits from (tagged
 * "via service"), inline nodes one per line, a danger badge for an upstream id that points nowhere.
 * A name's nodes are in a tooltip.
 */
export function UpstreamCell({ summary }: { summary: UpstreamSummary }) {
  const { source, refId, nodes } = summary;
  if (source === 'none') return <Empty />;
  if (source === 'missing') return <MissingRef kind="upstreams" id={refId ?? ''} />;
  const addresses = labelIsNodes(summary);
  if (source === 'inline') {
    return nodes.length > 0 ? <Lines lines={nodes} mono /> : <span className="tbl-line">{summary.label}</span>;
  }
  const kind = source === 'service' ? 'services' : 'upstreams';
  const link = (
    <Link className={addresses ? 'cell-link mono' : 'cell-link'} to={pathFor(kind, refId ?? '')}>
      {summary.label}
    </Link>
  );
  const withNodes =
    nodes.length > 0 && !(addresses && nodes.length === 1) ? (
      <Tooltip
        content={
          <span className="cell-tip-list">
            {nodes.map((node) => (
              <span key={node} className="mono">
                {node}
              </span>
            ))}
          </span>
        }
      >
        {link}
      </Tooltip>
    ) : (
      link
    );
  return (
    <>
      {withNodes}
      {source === 'service' && (
        <span className="cell-under">
          <ViaService />
        </span>
      )}
    </>
  );
}

/** Referrers listed in the "used by" tooltip before "and N more". */
const SHOWN_REFS = 8;

/**
 * How many objects point at this one (from referencesTo), the first of them in a tooltip as
 * "Route shop"; "unused" when none do.
 */
export function UsedByCell({ refs }: { refs: Reference[] }) {
  if (refs.length === 0) return <span className="cell-muted">{t('cell.unused')}</span>;
  const more = refs.length - SHOWN_REFS;
  return (
    <Tooltip
      content={
        <span className="cell-tip-list">
          {refs.slice(0, SHOWN_REFS).map((ref) => (
            <span key={`${ref.kind}/${ref.id}`}>{`${t(`kind.${ref.kind}.singular`)} ${ref.name}`}</span>
          ))}
          {more > 0 && <span className="cell-tip-note">{t('cell.usedByMore', { count: more })}</span>}
        </span>
      }
    >
      <button type="button" className="tbl-more cell-count" aria-label={t('cell.usedBy', { count: refs.length })}>
        {refs.length}
      </button>
    </Tooltip>
  );
}

/** An APISIX timestamp (epoch seconds) as how long ago, the date and time in a tooltip. */
export function TimeCell({ epoch }: { epoch: unknown }) {
  if (typeof epoch !== 'number' || !Number.isFinite(epoch)) return <Empty />;
  return (
    <Tooltip content={formatAbsolute(epoch)}>
      <time className="cell-time" dateTime={new Date(epoch * 1000).toISOString()}>
        {formatRelative(epoch)}
      </time>
    </Tooltip>
  );
}

async function copy(text: string) {
  try {
    if (!navigator.clipboard) throw new Error('clipboard unavailable');
    await navigator.clipboard.writeText(text);
    toast.success(t('cell.copied', { text }));
  } catch (err) {
    toast.error(t('cell.copyFailed', { error: err instanceof Error ? err.message : String(err) }));
  }
}

/** An id in monospace with a button that copies it. */
export function IdCell({ id }: { id: string }) {
  return (
    <span className="cell-id">
      <span className="cell-id__text mono" title={id}>
        {id}
      </span>
      <button type="button" className="cell-copy" aria-label={t('cell.copyId', { id })} title={t('cell.copyId', { id })} onClick={() => void copy(id)}>
        <Copy size={13} aria-hidden="true" />
      </button>
    </span>
  );
}
