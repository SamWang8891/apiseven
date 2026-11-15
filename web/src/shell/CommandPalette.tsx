// The command palette: one search box over every list the app shows, and the app's actions. Loaded
// on first open (the shell keeps only the hotkey and the header button). It reads the lists the shell
// already holds (Ctx) and, while open, the ones it doesn't (plugin metadata, protos, secrets); a list
// still loading or that failed says so in its place. Results go through the router, so an editor's
// leave guard asks before they leave it. Nothing here writes to APISIX.
import { Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useNavigate } from 'react-router';
import { useList, useSupportsAll } from '../api/hooks';
import type { Item, Kind } from '../api/types';
import { t } from '../i18n';
import { useCtx, type Ctx, type CtxList } from '../resources/ctx';
import { pathFor } from '../router/paths';
import { Dialog } from '../ui';
import { NAV_KINDS } from './nav';
import { usePaletteActions, type ActionGroup, type PaletteAction } from './paletteActions';
import { PaletteRow, type Row } from './PaletteRow';
import { entriesOf, KIND_ORDER, search, searchActions, type Entry, type Hit } from './search';
import { isMac, modHeld } from './usePaletteHotkey';
import type { PaletteExit } from './usePalette';
import './palette.css';

/** Rows per kind before "Show all N in <Kind>". */
const PER_GROUP = 6;

/** The lists the shell keeps (Ctx), by kind; the palette fetches the others while it is open. */
const CTX_LIST: Partial<Record<Kind, CtxList>> = {
  routes: 'routes',
  stream_routes: 'streamRoutes',
  services: 'services',
  upstreams: 'upstreams',
  consumers: 'consumers',
  consumer_groups: 'consumerGroups',
  ssls: 'ssls',
  global_rules: 'globalRules',
  plugin_configs: 'pluginConfigs',
};

/** A kind's list as the palette sees it. */
interface Source {
  kind: Kind;
  items: Item[];
  state: 'ready' | 'loading' | 'failed';
  error?: string;
}

interface Fetched {
  data?: Item[];
  failed: boolean;
  error?: string;
}

interface Indexed {
  entries: Entry[];
  byId: Map<string, Item>;
}

// The index of a list, kept per list (a list keeps its identity until its data changes) and across
// openings of the palette: never rebuilt per keystroke.
const indexes = new WeakMap<Item[], Partial<Record<Kind, Indexed>>>();

function indexOf(kind: Kind, items: Item[]): Indexed {
  let byKind = indexes.get(items);
  if (!byKind) {
    byKind = {};
    indexes.set(items, byKind);
  }
  let index = byKind[kind];
  if (!index) {
    index = { entries: entriesOf(kind, items), byId: new Map(items.map((item) => [item.id, item])) };
    byKind[kind] = index;
  }
  return index;
}

const NONE: Item[] = [];

/** A list the shell does not keep, asked for while the palette is open. */
function useFetched(kind: Kind): Fetched {
  const query = useList(kind);
  const { data, isError } = query;
  const error = query.error?.message;
  return useMemo(() => ({ data, failed: isError, error }), [data, isError, error]);
}

function sourceOf(kind: Kind, ctx: Ctx, fetched: Partial<Record<Kind, Fetched>>): Source {
  const list = CTX_LIST[kind];
  if (list) return { kind, items: ctx[list], state: ctx.loaded[list] ? 'ready' : ctx.failed[list] ? 'failed' : 'loading' };
  const own = fetched[kind];
  if (own?.data) return { kind, items: own.data, state: 'ready' };
  return { kind, items: NONE, state: own?.failed ? 'failed' : 'loading', error: own?.error };
}

/** Every list kind this APISIX has (or may have: the check still runs), with its list and its state. */
function useSources(): { kinds: Kind[]; sources: Source[] } {
  const ctx = useCtx();
  const metadata = useFetched('plugin_metadata');
  const protos = useFetched('protos');
  const secrets = useFetched('secrets');
  const supports = useSupportsAll(NAV_KINDS);
  const shown = NAV_KINDS.filter((kind) => supports[kind] !== false).join(',');
  return useMemo(() => {
    const kinds = NAV_KINDS.filter((kind) => shown.split(',').includes(kind));
    const fetched = { plugin_metadata: metadata, protos, secrets };
    return { kinds, sources: kinds.map((kind) => sourceOf(kind, ctx, fetched)) };
  }, [ctx, shown, metadata, protos, secrets]);
}

interface Group {
  key: string;
  label: string;
  rows: Row[];
}

const ACTION_GROUPS: ActionGroup[] = ['goTo', 'create', 'connections', 'theme'];

/**
 * What the list shows. An empty query: every action, by group. A query: the actions it matches,
 * then each kind's hits in sidebar order (at most PER_GROUP, then "Show all N"), or the kind's note
 * while its list loads or failed.
 */
function groupsOf(query: string, hits: Hit[], actions: PaletteAction[], sources: Source[]): Group[] {
  if (query.trim() === '') {
    return ACTION_GROUPS.map((group) => ({
      key: group,
      label: t(`palette.group.${group}`),
      rows: actions.filter((a) => a.group === group).map((action): Row => ({ type: 'action', key: action.id, action, query })),
    })).filter((g) => g.rows.length > 0);
  }
  const groups: Group[] = [];
  const matched = searchActions(actions, query);
  if (matched.length > 0) {
    groups.push({ key: 'actions', label: t('palette.group.actions'), rows: matched.map((action): Row => ({ type: 'action', key: action.id, action, query })) });
  }
  for (const kind of KIND_ORDER) {
    const source = sources.find((s) => s.kind === kind);
    if (!source) continue;
    const label = t(`kind.${kind}.plural`);
    if (source.state !== 'ready') {
      groups.push({ key: kind, label, rows: [{ type: 'note', key: `note:${kind}`, kind, state: source.state, error: source.error }] });
      continue;
    }
    const own = hits.filter((hit) => hit.entry.kind === kind);
    if (own.length === 0) continue;
    const byId = indexOf(kind, source.items).byId;
    const rows: Row[] = own.slice(0, PER_GROUP).map((hit) => ({ type: 'hit', key: `hit:${kind}:${hit.entry.id}`, hit, item: byId.get(hit.entry.id) }));
    if (own.length > PER_GROUP) rows.push({ type: 'more', key: `more:${kind}`, kind, count: own.length, query });
    groups.push({ key: kind, label, rows });
  }
  return groups;
}

/** The page a row opens (a hash-route path), when it opens one. */
function hrefOf(row: Row): string | undefined {
  switch (row.type) {
    case 'hit':
      return pathFor(row.hit.entry.kind, row.hit.entry.id, row.hit.entry.parent);
    case 'more':
      return `${pathFor(row.kind)}?${new URLSearchParams({ q: row.query.trim() }).toString()}`;
    case 'action':
      return row.action.href;
    default:
      return undefined;
  }
}

const countText = (count: number): string =>
  count === 0 ? t('palette.count.none') : count === 1 ? t('palette.count.one') : t('palette.count.other', { count });

export interface CommandPaletteProps {
  onClose: (how: PaletteExit) => void;
}

export default function CommandPalette({ onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const { kinds, sources } = useSources();
  const entries = useMemo(() => sources.flatMap((s) => (s.state === 'ready' ? indexOf(s.kind, s.items).entries : [])), [sources]);
  const hits = useMemo(() => search(entries, query), [entries, query]);

  const host = {
    go: (to: string, state?: unknown) => {
      onClose('navigate');
      void navigate(to, state === undefined ? undefined : { state });
    },
    dismiss: () => onClose('dismiss'),
  };
  const actions = usePaletteActions(kinds, host);
  const groups = groupsOf(query, hits, actions, sources);
  const choices = groups.flatMap((g) => g.rows.filter((row) => row.type !== 'note'));

  // The active choice, by position; back to the first whenever the query changes. A move by key
  // scrolls it into view; one by the pointer doesn't (the row is under it).
  const [cursor, setCursor] = useState({ query, index: 0, byPointer: false });
  const active = choices.length === 0 ? -1 : cursor.query === query ? Math.min(cursor.index, choices.length - 1) : 0;
  const moveTo = (index: number, byPointer = false) => setCursor({ query, index, byPointer });
  const scrolls = !(cursor.byPointer && cursor.query === query);

  const base = useId();
  const listId = `${base}-list`;
  const optionId = (index: number) => `${base}-o${index}`;
  useEffect(() => {
    if (active >= 0 && scrolls) document.getElementById(`${base}-o${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, scrolls, base]);

  // Only a pointer that moved picks a row: a browser reports a move when the list scrolls under a
  // resting pointer, which must not take the choice away from the keys.
  const pointer = useRef('');
  const hover = (index: number, e: PointerEvent) => {
    const at = `${e.clientX},${e.clientY}`;
    if (at === pointer.current) return;
    pointer.current = at;
    moveTo(index, true);
  };

  function run(row: Row, newTab: boolean) {
    const href = hrefOf(row);
    if (newTab && href !== undefined) {
      window.open(new URL(`#${href}`, window.location.href).href, '_blank', 'noopener');
      onClose('dismiss');
    } else if (row.type === 'action') {
      row.action.run();
    } else if (href !== undefined) {
      host.go(href);
    }
  }

  // Each choice's position, and the first choice of each group (PageUp / PageDown).
  const positions = new Map(choices.map((row, at) => [row.key, at]));
  const groupStarts = groups.flatMap((g) => {
    const first = g.rows.find((row) => row.type !== 'note');
    return first ? [positions.get(first.key) ?? 0] : [];
  });

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing || choices.length === 0) return;
    const n = choices.length;
    const own = groupStarts.filter((start) => start <= active).at(-1) ?? 0;
    const next: Record<string, number | undefined> = {
      ArrowDown: (active + 1) % n,
      ArrowUp: (active - 1 + n) % n,
      Home: 0,
      End: n - 1,
      PageDown: groupStarts.find((start) => start > active) ?? groupStarts.at(-1) ?? 0,
      PageUp: own < active ? own : (groupStarts.filter((start) => start < active).at(-1) ?? 0),
    };
    const to = next[e.key];
    if (to !== undefined) {
      e.preventDefault();
      moveTo(to);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = choices[active];
      if (row) run(row, modHeld(e));
    }
  }

  const typed = query.trim() !== '';
  const objects = hits.length + (typed ? searchActions(actions, query).length : 0);
  const partial = sources.some((s) => s.state !== 'ready');

  return (
    <Dialog open onClose={() => onClose('dismiss')} title={t('palette.title')}>
      <div className="cp">
        <div className="cp-search">
          <Search className="cp-search__icon" size={16} aria-hidden="true" />
          <input
            className="ui-input cp-input"
            role="combobox"
            aria-label={t('palette.input')}
            aria-expanded={groups.length > 0}
            aria-controls={groups.length > 0 ? listId : undefined}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? optionId(active) : undefined}
            placeholder={t('palette.placeholder')}
            autoComplete="off"
            spellCheck={false}
            // The dialog opens on the search box; the shell gives focus back when it closes.
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        {groups.length > 0 && (
          // The box keeps focus while a row is clicked.
          <div className="cp-list" role="listbox" id={listId} aria-label={t('palette.results')} onMouseDown={(e) => e.preventDefault()}>
            {groups.map((group) => (
              <div key={group.key} className="cp-group" role="group" aria-labelledby={`${base}-g-${group.key}`}>
                <div className="cp-group__heading" role="presentation" id={`${base}-g-${group.key}`}>
                  {group.label}
                </div>
                {group.rows.map((row) => {
                  const at = positions.get(row.key);
                  if (at === undefined) return <PaletteRow key={row.key} row={row} />;
                  return (
                    <PaletteRow
                      key={row.key}
                      row={row}
                      id={optionId(at)}
                      selected={at === active}
                      onHover={(e) => hover(at, e)}
                      onChoose={(newTab) => run(row, newTab)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        )}
        {typed && choices.length === 0 && <p className="cp-empty">{t(partial ? 'palette.noResultsPartial' : 'palette.noResults', { query: query.trim() })}</p>}
        <div className="cp-sr-only" role="status">
          {typed ? countText(objects) : ''}
        </div>
        <Hints />
      </div>
    </Dialog>
  );
}

function Hints() {
  return (
    <div className="cp-hints" aria-hidden="true">
      <span>
        <kbd>{t('palette.key.move')}</kbd>
        {t('palette.hint.move')}
      </span>
      <span>
        <kbd>{t('palette.key.enter')}</kbd>
        {t('palette.hint.open')}
      </span>
      <span>
        <kbd>{t(isMac() ? 'palette.key.modEnter.mac' : 'palette.key.modEnter.other')}</kbd>
        {t('palette.hint.newTab')}
      </span>
      <span>
        <kbd>{t('palette.key.esc')}</kbd>
        {t('palette.hint.close')}
      </span>
    </div>
  );
}
