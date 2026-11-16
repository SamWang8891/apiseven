// An upstream's nodes, in either shape APISIX takes: a map `{ "host:port": weight }` or an array of
// `{ host, port, weight, priority, … }`. Edits keep the loaded shape: an array row is changed in
// place (keys the form doesn't show, such as `metadata`, stay), a map entry is renamed or reweighed
// where it stands. A map stays a map through every edit but two: a priority other than 0, which
// only the array holds, and keeping two entries at one address when the user asks to (keepBoth).
// In between, a map entry may have an empty host (key ":80" or "") or no weight (null), which
// upstreamIssues flags on its row; an address another entry has is refused, never merged. A list
// that has no shape yet is an array.
import { isObj } from '../api/sanitize';
import type { Obj } from '../api/types';
import { removeAt, setPath, setPathRaw } from '../editor/draft';

export interface NodeRow {
  host?: string;
  port?: number;
  weight?: number;
  priority?: number;
  /** The map key the row was read from, kept while its host and port are untouched. */
  addr?: string;
}

/** The weight a new node gets (the form's default). */
export const NEW_WEIGHT = 1;

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * A map key read as `core.utils.parse_addr` reads it: `[v6]:port` (the brackets stay in the host),
 * `host:port`, a bare host, or a bare IPv6 address (two colons before any dot). A port that isn't
 * digits leaves the whole key as the host.
 */
export function parseAddr(addr: string): { host: string; port?: number } {
  if (addr.startsWith('[')) {
    if (addr.endsWith(']')) return { host: addr };
    const at = addr.lastIndexOf(':');
    if (at < 1 || addr[at - 1] !== ']') return { host: addr };
    const port = addr.slice(at + 1);
    return /^\d+$/.test(port) ? { host: addr.slice(0, at), port: Number(port) } : { host: addr };
  }
  const dot = addr.indexOf('.');
  const beforeDot = dot < 0 ? addr : addr.slice(0, dot);
  if ((beforeDot.match(/:/g) ?? []).length >= 2) return { host: addr };
  const at = addr.indexOf(':');
  if (at < 0) return { host: addr };
  const port = addr.slice(at + 1);
  return /^\d+$/.test(port) ? { host: addr.slice(0, at), port: Number(port) } : { host: addr };
}

/** The map key of a host and port; a bare IPv6 host gets brackets before its port. */
export function addrOf(host: string, port: number | undefined): string {
  if (port === undefined) return host;
  return host.includes(':') && !host.startsWith('[') ? `[${host}]:${port}` : `${host}:${port}`;
}

/** The node rows in order: an array's entries (anything but an object reads as an empty row), a map's keys. */
export function rowsOf(nodes: unknown): NodeRow[] {
  if (Array.isArray(nodes)) {
    return nodes.map((node) => {
      if (!isObj(node)) return {};
      const row: NodeRow = {};
      if (typeof node.host === 'string') row.host = node.host;
      if (num(node.port) !== undefined) row.port = num(node.port);
      if (num(node.weight) !== undefined) row.weight = num(node.weight);
      if (num(node.priority) !== undefined) row.priority = num(node.priority);
      return row;
    });
  }
  if (isObj(nodes)) {
    return Object.entries(nodes).map(([addr, weight]) => {
      const row: NodeRow = { ...parseAddr(addr), addr };
      if (num(weight) !== undefined) row.weight = num(weight);
      return row;
    });
  }
  return [];
}

/** An address being edited: the host as typed ('' allowed) and the port. */
export interface Address {
  host: string;
  port: number | undefined;
}

/**
 * An address with the port its host holds moved to its port, as parseAddr reads it: `10.0.0.5:8080`,
 * `[::1]:9000`. Only on the user's explicit commit (Enter, "Move <port> to Port", each address of a paste
 * of several), never on leaving a field. Anything else is left as it is.
 */
export function committed(address: Address): Address {
  const parsed = parseAddr(address.host);
  return parsed.port === undefined ? address : { host: parsed.host, port: parsed.port };
}

/** The port a node's host holds (`10.0.0.5:8080`), which APISIX would read as part of the host name; undefined for none. */
export const portInHost = (host: string | undefined): number | undefined => (host === undefined ? undefined : parseAddr(host).port);

/** Whether `host` is an IPv6 address, bare (`fe80::1`) or in brackets (`[fe80::1]`): the one kind of host that holds colons. */
export function isIpv6(host: string): boolean {
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (!bare.includes(':')) return false;
  try {
    new URL(`http://[${bare}]/`);
    return true;
  } catch {
    return false;
  }
}

/** A colon in a host that is not an IPv6 address (`10.0.0.5:`, `10.0.0.5:8080`, `a:b`): APISIX would look it all up as a name. */
export const strayColon = (host: string): boolean => host.includes(':') && !isIpv6(host);

/**
 * What became of an address edit on a map: done, or refused because another entry (`other`) has
 * that address, or held: an all-digit host without a port ('digits', until an explicit commit passes
 * commitDigits: JavaScript would move the entry to the top of the map, integer-like keys first), or a
 * host with a stray colon ('colon': no map key can hold it). Leaving a field ends neither.
 */
export type AddressEdit = { ok: true; up: Obj } | { ok: false; reason: 'digits' | 'colon' } | { ok: false; reason: 'duplicate'; other: number };

/** A row as an array entry: the fields it has. */
function nodeOf(row: NodeRow): Obj {
  const node: Obj = {};
  if (row.host !== undefined && row.host !== '') node.host = row.host;
  if (row.port !== undefined) node.port = row.port;
  if (row.weight !== undefined) node.weight = row.weight;
  if (row.priority !== undefined) node.priority = row.priority;
  return node;
}

const list = (up: Obj): unknown[] => (Array.isArray(up.nodes) ? up.nodes : []);
const entriesOf = (up: Obj): [string, unknown][] => (isObj(up.nodes) ? Object.entries(up.nodes) : []);
const writeMap = (up: Obj, entries: [string, unknown][]): Obj => setPathRaw(up, ['nodes'], Object.fromEntries(entries));
const isDigits = (address: Address): boolean => address.port === undefined && /^\d+$/.test(address.host);

/** Why `address` can't take entry `index`'s place in a map (index = the entry count: a new entry). */
function refusal(entries: [string, unknown][], index: number, address: Address, commitDigits: boolean): AddressEdit | undefined {
  if (strayColon(address.host)) return { ok: false, reason: 'colon' };
  const key = addrOf(address.host, address.port);
  const other = entries.findIndex(([k], j) => j !== index && k === key);
  if (other >= 0) return { ok: false, reason: 'duplicate', other };
  if (!commitDigits && isDigits(address)) return { ok: false, reason: 'digits' };
  return undefined;
}

/** Gives map entry `index` a new address where it stands, its weight kept. */
export function setMapAddress(up: Obj, index: number, address: Address, opts: { commitDigits?: boolean } = {}): AddressEdit {
  const entries = entriesOf(up);
  const entry = entries[index];
  if (!entry) return { ok: true, up };
  const refused = refusal(entries, index, address, opts.commitDigits ?? false);
  if (refused) return refused;
  entries[index] = [addrOf(address.host, address.port), entry[1]];
  return { ok: true, up: writeMap(up, entries) };
}

/** Adds an entry with the default weight at the end of a map, unless refused as setMapAddress would. */
export function addMapNode(up: Obj, address: Address, opts: { commitDigits?: boolean } = {}): AddressEdit {
  const entries = entriesOf(up);
  const refused = refusal(entries, entries.length, address, opts.commitDigits ?? false);
  if (refused) return refused;
  return { ok: true, up: writeMap(up, [...entries, [addrOf(address.host, address.port), NEW_WEIGHT]]) };
}

/**
 * Sets one field of node `index` (undefined or '' clears it). In an array, in place. In a map: a
 * cleared weight stays as null (flagged until filled); a priority other than 0 turns the list into
 * the array shape, weights kept, and 0 or none changes nothing (it is what the map means); host and
 * port go through setMapAddress, and a refused address changes nothing.
 */
export function setNodeField(up: Obj, index: number, field: 'host' | 'port' | 'weight' | 'priority', value: string | number | undefined): Obj {
  if (!isObj(up.nodes)) return setPath(up, ['nodes', index, field], value);
  const entries = entriesOf(up);
  const entry = entries[index];
  if (!entry) return up;
  if (field === 'weight') {
    entries[index] = [entry[0], value === undefined || value === '' ? null : value];
    return writeMap(up, entries);
  }
  if (field === 'priority') {
    if (typeof value !== 'number' || value === 0) return up;
    const rows = rowsOf(up.nodes);
    rows[index] = { ...rows[index], priority: value };
    return setPathRaw(up, ['nodes'], rows.map(nodeOf));
  }
  const row = rowsOf(up.nodes)[index] ?? {};
  const address: Address = field === 'host' ? { host: String(value ?? ''), port: row.port } : { host: row.host ?? '', port: typeof value === 'number' ? value : undefined };
  const edit = setMapAddress(up, index, address, { commitDigits: true });
  return edit.ok ? edit.up : up;
}

/**
 * Turns a map into the array shape with entry `index` at `address` (index = the entry count: a new
 * node), so two nodes can share an address: what the user chose with "Keep both". Weights are kept.
 */
export function keepBoth(up: Obj, index: number, address: Address): Obj {
  const rows = rowsOf(up.nodes);
  const moved: NodeRow = { ...(rows[index] ?? { weight: NEW_WEIGHT }), host: address.host, port: address.port };
  delete moved.addr;
  rows[index] = moved;
  return setPathRaw(up, ['nodes'], rows.map(nodeOf));
}

/**
 * Appends nodes (a list without a shape becomes an array). A map leaves out an address it already
 * has (or that came earlier in `added`): those are returned in `skipped`, for the caller to name.
 */
export function addNodes(up: Obj, added: NodeRow[]): { up: Obj; skipped: string[] } {
  if (!isObj(up.nodes)) return { up: setPathRaw(up, ['nodes'], [...list(up), ...added.map(nodeOf)]), skipped: [] };
  const entries = entriesOf(up);
  const skipped: string[] = [];
  for (const row of added) {
    const key = addrOf(row.host ?? '', row.port);
    if (entries.some(([k]) => k === key)) skipped.push(key);
    else entries.push([key, row.weight ?? NEW_WEIGHT]);
  }
  return { up: skipped.length === added.length ? up : writeMap(up, entries), skipped };
}

/** Removes node `index`; the emptied list stays as an empty list of its shape while it is edited. */
export function removeNode(up: Obj, index: number): Obj {
  if (isObj(up.nodes)) {
    const entries = entriesOf(up);
    if (index < 0 || index >= entries.length) return up;
    entries.splice(index, 1);
    return writeMap(up, entries);
  }
  const next = removeAt(up, ['nodes'], index);
  return next !== up && next.nodes === undefined ? setPathRaw(next, ['nodes'], []) : next;
}

/** The address a map copy of entry `index` gets: its port with an empty host, to type the new host into. */
const copyKey = (up: Obj, index: number): string => addrOf('', rowsOf(up.nodes)[index]?.port);

/** Whether node `index` can be duplicated: always in an array; in a map, while the copy's empty address is free. */
export function canDuplicate(up: Obj, index: number): boolean {
  if (!isObj(up.nodes)) return true;
  const key = copyKey(up, index);
  return !Object.hasOwn(up.nodes, key);
}

/**
 * Inserts a copy of node `index` after it. A map can't hold one address twice, so its copy keeps the
 * port and weight with an empty host, to be filled in (unchanged when that address is taken).
 */
export function duplicateNode(up: Obj, index: number): Obj {
  if (isObj(up.nodes)) {
    const entries = entriesOf(up);
    const entry = entries[index];
    if (!entry || !canDuplicate(up, index)) return up;
    entries.splice(index + 1, 0, [copyKey(up, index), entry[1]]);
    return writeMap(up, entries);
  }
  const nodes = [...list(up)];
  if (index < 0 || index >= nodes.length) return up;
  nodes.splice(index + 1, 0, structuredClone(nodes[index]));
  return setPathRaw(up, ['nodes'], nodes);
}

/** The addresses in pasted text, each as pasted: separated by line breaks, commas or spaces. */
export function splitNodeList(text: string): string[] {
  return text.split(/[\s,]+/).filter(Boolean);
}

/** A node's part of the requests: a fraction of 1, or standing by for a higher priority. */
export type Share = number | 'standby' | undefined;

/**
 * Each node's expected share of requests: the nodes of the highest priority split them by weight
 * (APISIX's priority balancer only falls back to a lower priority when all higher nodes are down).
 * Undefined for algorithms whose split depends on load rather than weight (ewma, least_conn).
 */
export function sharesOf(rows: NodeRow[], type: string | undefined): Share[] | undefined {
  if (type !== undefined && type !== 'roundrobin' && type !== 'chash') return undefined;
  const tier = (row: NodeRow) => row.priority ?? 0;
  const top = Math.max(...rows.map(tier));
  const weightOf = (row: NodeRow) => (row.weight !== undefined && row.weight > 0 ? row.weight : 0);
  const total = rows.filter((row) => tier(row) === top).reduce((sum, row) => sum + weightOf(row), 0);
  return rows.map((row) => {
    if (tier(row) < top) return 'standby';
    if (row.weight === undefined) return undefined;
    return total > 0 ? weightOf(row) / total : 0;
  });
}

/** Whether the upstream finds its nodes through service discovery: no `nodes`, and a discovery field set. */
export function usesDiscovery(up: Obj): boolean {
  return up.nodes === undefined && (up.discovery_type !== undefined || up.service_name !== undefined || up.discovery_args !== undefined);
}
