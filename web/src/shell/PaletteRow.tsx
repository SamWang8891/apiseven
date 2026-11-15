// One row of the command palette: an object found (kind icon, title, the field that matched with the
// match marked, its state), "Show all N in <Kind>", an action, or a list's loading / failed note.
import {
  CircleAlert,
  FileCode,
  Globe,
  KeyRound,
  Layers,
  ListFilter,
  Loader,
  Puzzle,
  Route,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  User,
  Users,
  Vault,
  Waypoints,
  type LucideIcon,
} from 'lucide-react';
import type { PointerEvent, ReactNode } from 'react';
import type { Item, Kind } from '../api/types';
import { t } from '../i18n';
import { ExpiryBadge, expiryTone } from '../resources/expiry';
import { isEnabled, sslNotAfter } from '../resources/resolve';
import { statusApplies } from '../resources/ssls/usage';
import { StatusBadge } from '../table/StatusCell';
import type { PaletteAction } from './paletteActions';
import { labelRanges, type FieldName, type Hit } from './search';

export type Row =
  | { type: 'hit'; key: string; hit: Hit; item?: Item }
  | { type: 'more'; key: string; kind: Kind; count: number; query: string }
  | { type: 'action'; key: string; action: PaletteAction; query: string }
  | { type: 'note'; key: string; kind: Kind; state: 'loading' | 'failed'; error?: string };

const ICONS: Record<Kind, LucideIcon> = {
  routes: Route,
  stream_routes: Waypoints,
  services: Layers,
  upstreams: Server,
  consumers: User,
  credentials: KeyRound,
  consumer_groups: Users,
  ssls: ShieldCheck,
  secrets: Vault,
  global_rules: Globe,
  plugin_configs: Puzzle,
  plugin_metadata: SlidersHorizontal,
  protos: FileCode,
};

/** Fields whose values are hosts, URIs, ids or addresses: monospace. */
const MONO = new Set<FieldName>(['id', 'host', 'uri', 'sni', 'node', 'address', 'username']);

/** What a field is called in a row's second line; an SSL's `host` is a name in its certificate. */
const fieldLabel = (kind: Kind, field: FieldName): string => t(kind === 'ssls' && field === 'host' ? 'palette.field.ssls.host' : `palette.field.${field}`);

/** `text` with the `ranges` marked. */
function Marked({ text, ranges }: { text: string; ranges: [number, number][] }) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(<mark key={start}>{text.slice(start, end)}</mark>);
    at = end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

/** A disabled route or SSL, an expired certificate: the list cells' badges. */
function State({ kind, item }: { kind: Kind; item?: Item }) {
  if (!item) return null;
  const disabled = (kind === 'routes' || (kind === 'ssls' && statusApplies(item.value))) && !isEnabled(item.value);
  const notAfter = kind === 'ssls' ? sslNotAfter(item.value) : undefined;
  const expired = expiryTone(notAfter) === 'danger';
  if (!disabled && !expired) return null;
  return (
    <span className="cp-row__end">
      {disabled && <StatusBadge kind={kind} item={item} />}
      {expired && <ExpiryBadge notAfter={notAfter} />}
    </span>
  );
}

function HitContent({ hit, item }: { hit: Hit; item?: Item }) {
  const { entry, field, text, ranges } = hit;
  const Icon = ICONS[entry.kind];
  // The title is the object's name, else its id (a host for an SSL): monospace unless it is a name.
  const titleMono = entry.title === entry.id || entry.kind === 'ssls';
  const inTitle = text === entry.title;
  return (
    <>
      <span className="cp-row__icon" aria-hidden="true">
        <Icon size={15} />
      </span>
      <span className="cp-row__text">
        <span className={titleMono ? 'cp-row__title mono' : 'cp-row__title'}>
          <Marked text={entry.title} ranges={inTitle ? ranges : []} />
        </span>{' '}
        {!inTitle && (
          <span className="cp-row__detail">
            <span className="cp-row__field">{fieldLabel(entry.kind, field)}</span>{' '}
            <span className={MONO.has(field) ? 'mono' : undefined}>
              <Marked text={text} ranges={ranges} />
            </span>
          </span>
        )}
      </span>
      <State kind={entry.kind} item={item} />
    </>
  );
}

function content(row: Row): ReactNode {
  switch (row.type) {
    case 'hit':
      return <HitContent hit={row.hit} item={row.item} />;
    case 'more':
      return (
        <>
          <span className="cp-row__icon" aria-hidden="true">
            <ListFilter size={15} />
          </span>
          <span className="cp-row__text cp-row__more">{t('palette.showAll', { count: row.count, plural: t(`kind.${row.kind}.plural`) })}</span>
        </>
      );
    case 'action':
      return (
        <>
          <span className="cp-row__icon" aria-hidden="true">
            {row.action.icon}
          </span>
          <span className="cp-row__text">
            <span className="cp-row__title">
              <Marked text={row.action.label} ranges={labelRanges(row.action.label, row.query)} />
            </span>
          </span>
        </>
      );
    case 'note':
      return (
        <>
          <span className="cp-row__icon" aria-hidden="true">
            {row.state === 'loading' ? <Loader size={15} /> : <CircleAlert size={15} />}
          </span>
          <span className="cp-row__text">
            {t(row.state === 'loading' ? 'palette.loading' : 'palette.failed', { plural: t(`kind.${row.kind}.plural`) })}
          </span>
        </>
      );
  }
}

export interface PaletteRowProps {
  row: Row;
  /** A choice's option id, whether it is the active one, and its handlers; a note has none of them. */
  id?: string;
  selected?: boolean;
  onHover?: (e: PointerEvent) => void;
  onChoose?: (newTab: boolean) => void;
}

export function PaletteRow({ row, id, selected = false, onHover, onChoose }: PaletteRowProps) {
  if (row.type === 'note') {
    return (
      <div className={`cp-row cp-row--note${row.state === 'failed' ? ' cp-row--failed' : ''}`} role="option" aria-selected={false} aria-disabled title={row.error}>
        {content(row)}
      </div>
    );
  }
  return (
    <div
      id={id}
      className="cp-row"
      role="option"
      aria-selected={selected}
      onPointerMove={selected ? undefined : onHover}
      onClick={(e) => onChoose?.(e.metaKey || e.ctrlKey)}
    >
      {content(row)}
    </div>
  );
}
