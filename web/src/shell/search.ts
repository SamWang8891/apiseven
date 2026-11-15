// The command palette's index and search: pure, no React. An entry holds what an object is found by
// (its name, id, hosts, URIs, …), read from the object as the locked views show it (redactObject,
// without the plugin list: every secret by name or encrypt path masked, every plugin value masked),
// and never a value it masks; plugin configs give their names only, never a value, and a private-key
// block is dropped from any text (as the list search drops it: table/filter.ts).
import { isObj } from '../api/sanitize';
import type { Item, Kind, Obj, Parent } from '../api/types';
import { redactObject } from '../plugins/secrets';
import { registry } from '../resources/registry';
import { labelPairs } from '../resources/resolve';
import { certOf } from '../resources/ssls/usage';
import { MASK, withoutPrivateKeys } from '../schema/secrets';
import { addrOf, rowsOf } from '../upstream/nodes';
import { NAV_KINDS } from './nav';

export type FieldName = 'name' | 'id' | 'desc' | 'host' | 'uri' | 'sni' | 'username' | 'node' | 'label' | 'plugin' | 'address';

export interface Entry {
  kind: Kind;
  id: string;
  parent?: Parent;
  /** nameOf, else the id. */
  title: string;
  /** Everything the entry is found by, as shown (search lower-cases each text once, on first use). */
  fields: { name: FieldName; text: string }[];
}

export interface Hit {
  entry: Entry;
  /** The field that matched best, and its original text. */
  field: FieldName;
  text: string;
  /** Where the query's words are in `text` ([start, end)), for highlighting; sorted, never overlapping. */
  ranges: [number, number][];
  score: number;
}

export interface Action {
  id: string;
  label: string;
  /** More words the action is found by (synonyms), besides its label. */
  keywords: string;
  run(): void;
}

/** The kinds in the order ties and groups follow: the sidebar's, a consumer's credentials after consumers. */
export const KIND_ORDER: Kind[] = NAV_KINDS.flatMap((kind): Kind[] => (kind === 'consumers' ? [kind, 'credentials'] : [kind]));

const rank = (kind: Kind): number => {
  const at = KIND_ORDER.indexOf(kind);
  return at < 0 ? KIND_ORDER.length : at;
};

// --- the index ---------------------------------------------------------------------------------

const strings = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Collects an entry's fields: text only, trimmed, without private-key blocks or masks, each once. */
class Fields {
  readonly list: Entry['fields'] = [];
  private readonly seen = new Set<string>();

  add(name: FieldName, value: unknown): void {
    if (typeof value === 'number' && Number.isFinite(value)) value = String(value);
    if (typeof value !== 'string') return;
    const text = withoutPrivateKeys(value, ' ').trim();
    if (text === '' || text.includes(MASK)) return;
    const key = `${name}\u0000${text}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.list.push({ name, text });
  }

  addAll(name: FieldName, values: unknown[]): void {
    for (const value of values) this.add(name, value);
  }

  /** Each plugin's name (never its config). */
  plugins(value: Obj): void {
    if (isObj(value.plugins)) this.addAll('plugin', Object.keys(value.plugins));
  }

  /** An upstream's node addresses (`host:port`, either shape of `nodes`) and its discovery service name. */
  nodes(upstream: unknown): void {
    if (!isObj(upstream)) return;
    for (const row of rowsOf(upstream.nodes)) if (row.host) this.add('node', addrOf(row.host, row.port));
    this.add('node', upstream.service_name);
  }
}

/** The fields of one object, read from `shown` (its masked view). */
function fieldsOf(kind: Kind, id: string, shown: Obj): Entry['fields'] {
  const f = new Fields();
  f.add('id', id);
  f.add('name', shown.name);
  if (kind === 'consumers') f.add('username', shown.username);
  f.add('desc', shown.desc);
  for (const [key, value] of labelPairs(shown.labels)) f.add('label', `${key}:${value}`);
  switch (kind) {
    case 'routes':
      f.add('host', shown.host);
      f.addAll('host', strings(shown.hosts));
      f.add('uri', shown.uri);
      f.addAll('uri', strings(shown.uris));
      f.add('address', shown.remote_addr);
      f.addAll('address', strings(shown.remote_addrs));
      f.plugins(shown);
      f.nodes(shown.upstream);
      break;
    case 'stream_routes':
      f.add('address', shown.server_addr);
      f.add('address', shown.server_port);
      f.add('address', shown.remote_addr);
      f.add('sni', shown.sni);
      f.plugins(shown);
      f.nodes(shown.upstream);
      break;
    case 'services':
      f.addAll('host', strings(shown.hosts));
      f.plugins(shown);
      f.nodes(shown.upstream);
      break;
    case 'upstreams':
      f.nodes(shown);
      break;
    case 'ssls': {
      f.add('sni', shown.sni);
      f.addAll('sni', strings(shown.snis));
      // parseCert is memoised per PEM; a reference or an unreadable certificate gives nothing.
      const cert = certOf(shown);
      const cn = cert?.subject.split(', ').find((part) => part.startsWith('CN='))?.slice(3);
      f.add('host', cn);
      f.addAll('host', cert?.sans ?? []);
      break;
    }
    case 'consumers':
    case 'credentials':
    case 'consumer_groups':
    case 'plugin_configs':
    case 'global_rules':
      f.plugins(shown);
      break;
    default:
      // Plugin metadata (its id is the plugin's name), protos, secrets: the common fields.
      break;
  }
  return f.list;
}

/** The text an id reads as (APISIX ids are strings or integers). */
const idText = (id: unknown): string | undefined => (typeof id === 'string' ? id : typeof id === 'number' && Number.isFinite(id) ? String(id) : undefined);

/**
 * The search entries of a kind's objects, one per object with an id, in order (credentials need
 * their consumer as `parent`). Never throws: a value of any shape gives what it can, at least its id.
 */
export function entriesOf(kind: Kind, items: Item[], parent?: Parent): Entry[] {
  const out: Entry[] = [];
  for (const item of Array.isArray(items) ? (items as unknown[]) : []) {
    if (!isObj(item)) continue;
    const id = idText(item.id);
    if (id === undefined) continue;
    const value = isObj(item.value) ? item.value : {};
    let title = id;
    let fields: Entry['fields'] = [{ name: 'id', text: id }];
    try {
      title = withoutPrivateKeys(registry[kind].nameOf({ id, value }), ' ').trim() || id;
      fields = fieldsOf(kind, id, redactObject(value, kind, undefined, id).value);
    } catch {
      // A shape nothing above expected: the id alone.
    }
    out.push(parent ? { kind, id, parent, title, fields } : { kind, id, title, fields });
  }
  return out;
}

// --- matching ----------------------------------------------------------------------------------

/** How good a word's match is: an exact id or name > a prefix of a name-like field > a word start > anywhere. */
const EXACT = 400;
const PREFIX = 300;
const BOUNDARY = 200;
const SUBSTRING = 100;
/** A match in the name outranks the same kind of match elsewhere. */
const NAME_BONUS = 10;

/** Fields whose start is what a user types first. */
const PREFIX_FIELDS = new Set<FieldName>(['name', 'id', 'host', 'uri', 'username', 'sni']);
const BOUNDARY_CHARS = new Set(['.', '/', '-', '_', ':', ' ', '@', '*']);

/** The query's words, lower-cased. */
export function tokensOf(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Where `token` best starts in `lower`: the first word start, else the first occurrence; -1 when absent. */
function bestAt(lower: string, token: string): { at: number; boundary: boolean } {
  const first = lower.indexOf(token);
  for (let at = first; at >= 0; at = lower.indexOf(token, at + 1)) {
    if (at === 0 || BOUNDARY_CHARS.has(lower[at - 1] ?? '')) return { at, boundary: true };
  }
  return { at: first, boundary: false };
}

/** The score of `token` in one field (0: not in it). */
function scoreIn(field: FieldName, lower: string, token: string): number {
  const { at, boundary } = bestAt(lower, token);
  if (at < 0) return 0;
  const bonus = field === 'name' ? NAME_BONUS : 0;
  if (lower === token && (field === 'id' || field === 'name')) return EXACT + bonus;
  if (at === 0 && PREFIX_FIELDS.has(field)) return PREFIX + bonus;
  return (boundary ? BOUNDARY : SUBSTRING) + bonus;
}

/** Each token's best place in `lower`, merged into sorted ranges; none when lower-casing changed the length. */
function rangesIn(lower: string, text: string, tokens: string[]): [number, number][] {
  if (lower.length !== text.length) return [];
  const spans = tokens
    .map((token) => ({ at: bestAt(lower, token).at, len: token.length }))
    .filter((s) => s.at >= 0)
    .map((s): [number, number] => [s.at, s.at + s.len])
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push(span);
  }
  return merged;
}

const lowered = new WeakMap<Entry, string[]>();

function lowerOf(entry: Entry): string[] {
  let lower = lowered.get(entry);
  if (!lower) {
    lower = entry.fields.map((field) => field.text.toLowerCase());
    lowered.set(entry, lower);
  }
  return lower;
}

const compareText = (a: string, b: string): number => a.localeCompare(b);

/**
 * The entries every word of `query` (split on spaces, any case) matches some field of, best first:
 * by the sum of each word's best score, then sidebar kind order, then title. '' finds nothing.
 */
export function search(entries: Entry[], query: string): Hit[] {
  const tokens = tokensOf(query);
  if (tokens.length === 0) return [];
  const hits: Hit[] = [];
  for (const entry of entries) {
    const lower = lowerOf(entry);
    let total = 0;
    let best = -1;
    let bestScore = 0;
    let all = true;
    for (const token of tokens) {
      let tokenScore = 0;
      let tokenField = -1;
      for (let i = 0; i < lower.length; i++) {
        const score = scoreIn(entry.fields[i]?.name ?? 'id', lower[i] ?? '', token);
        if (score > tokenScore) [tokenScore, tokenField] = [score, i];
      }
      if (tokenScore === 0) {
        all = false;
        break;
      }
      total += tokenScore;
      if (tokenScore > bestScore) [bestScore, best] = [tokenScore, tokenField];
    }
    const field = entry.fields[best];
    if (!all || !field) continue;
    hits.push({ entry, field: field.name, text: field.text, ranges: rangesIn(lower[best] ?? '', field.text, tokens), score: total });
  }
  return hits.sort(
    (a, b) =>
      b.score - a.score ||
      rank(a.entry.kind) - rank(b.entry.kind) ||
      compareText(a.entry.title, b.entry.title) ||
      compareText(a.entry.id, b.entry.id),
  );
}

/**
 * The actions every word of `query` matches (in the label or the keywords), best first, ties in
 * their own order; all of them, as they are, for an empty query.
 */
export function searchActions<A extends Action>(actions: A[], query: string): A[] {
  const tokens = tokensOf(query);
  if (tokens.length === 0) return actions;
  const scored: { action: A; score: number; order: number }[] = [];
  actions.forEach((action, order) => {
    const label = action.label.toLowerCase();
    const keywords = action.keywords.toLowerCase();
    let score = 0;
    for (const token of tokens) {
      const s = Math.max(scoreIn('name', label, token), scoreIn('desc', keywords, token));
      if (s === 0) return;
      score += s;
    }
    scored.push({ action, score, order });
  });
  return scored.sort((a, b) => b.score - a.score || a.order - b.order).map((s) => s.action);
}

/** Where each word of `query` is in an action's label, for highlighting. */
export function labelRanges(label: string, query: string): [number, number][] {
  return rangesIn(label.toLowerCase(), label, tokensOf(query));
}
