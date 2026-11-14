// An upstream's nodes, in either shape APISIX takes: a map `{ "host:port": weight }` or an array of
// `{ host, port, weight, priority, … }`. Edits keep the loaded shape: an array row is changed in
// place (keys the form doesn't show, such as `metadata`, stay), a map is rebuilt in the same order.
// A map can't hold a priority, a row without host or weight, or one address twice; a row like that
// turns the list into the array shape, which can. A list that has no shape yet is an array.
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

/** The rows as a map, or undefined when one of them doesn't fit a map. */
function toMap(rows: NodeRow[]): Obj | undefined {
  const map: Obj = {};
  for (const row of rows) {
    if (!row.host || row.weight === undefined || row.priority !== undefined) return undefined;
    const key = row.addr ?? addrOf(row.host, row.port);
    if (Object.hasOwn(map, key)) return undefined;
    map[key] = row.weight;
  }
  return map;
}

/** A row as an array entry: the fields it has. */
function nodeOf(row: NodeRow): Obj {
  const node: Obj = {};
  if (row.host !== undefined && row.host !== '') node.host = row.host;
  if (row.port !== undefined) node.port = row.port;
  if (row.weight !== undefined) node.weight = row.weight;
  if (row.priority !== undefined) node.priority = row.priority;
  return node;
}

/** Writes map-shaped rows back: as the map while it holds them all, else as the array. */
function writeMapRows(up: Obj, rows: NodeRow[]): Obj {
  return setPathRaw(up, ['nodes'], toMap(rows) ?? rows.map(nodeOf));
}

const list = (up: Obj): unknown[] => (Array.isArray(up.nodes) ? up.nodes : []);

/** Sets one field of node `index` (undefined or '' clears it). */
export function setNodeField(up: Obj, index: number, field: 'host' | 'port' | 'weight' | 'priority', value: string | number | undefined): Obj {
  if (isObj(up.nodes)) {
    const rows = rowsOf(up.nodes);
    const row = { ...rows[index], [field]: value === '' ? undefined : value };
    if (field === 'host' || field === 'port') delete row.addr;
    rows[index] = row;
    return writeMapRows(up, rows);
  }
  return setPath(up, ['nodes', index, field], value);
}

/** Appends nodes (a list without a shape becomes an array). */
export function addNodes(up: Obj, added: NodeRow[]): Obj {
  if (isObj(up.nodes)) return writeMapRows(up, [...rowsOf(up.nodes), ...added]);
  return setPathRaw(up, ['nodes'], [...list(up), ...added.map(nodeOf)]);
}

/**
 * Pasted addresses landing in node `index`'s host: the first replaces that node's host (and its
 * port, when the paste has one), the rest are added after it with the default weight.
 */
export function pasteNodes(up: Obj, index: number, pasted: NodeRow[]): Obj {
  const [first, ...rest] = pasted;
  if (!first) return up;
  const added = rest.map((row) => ({ ...row, weight: NEW_WEIGHT }));
  if (isObj(up.nodes)) {
    const rows = rowsOf(up.nodes);
    const row: NodeRow = { ...rows[index], host: first.host };
    delete row.addr;
    if (first.port !== undefined) row.port = first.port;
    rows.splice(index, 1, row, ...added);
    return writeMapRows(up, rows);
  }
  const nodes = [...list(up)];
  const node: Obj = { ...(isObj(nodes[index]) ? nodes[index] : {}), host: first.host };
  if (first.port !== undefined) node.port = first.port;
  nodes.splice(index, 1, node, ...added.map(nodeOf));
  return setPathRaw(up, ['nodes'], nodes);
}

/** Removes node `index`; the emptied list stays as an empty list of its shape while it is edited. */
export function removeNode(up: Obj, index: number): Obj {
  if (isObj(up.nodes)) {
    const rows = rowsOf(up.nodes);
    rows.splice(index, 1);
    return writeMapRows(up, rows);
  }
  const next = removeAt(up, ['nodes'], index);
  return next !== up && next.nodes === undefined ? setPathRaw(next, ['nodes'], []) : next;
}

/** Inserts a copy of node `index` after it (a map can't hold the same address twice: it becomes an array). */
export function duplicateNode(up: Obj, index: number): Obj {
  if (isObj(up.nodes)) {
    const rows = rowsOf(up.nodes);
    const row = rows[index];
    if (!row) return up;
    rows.splice(index + 1, 0, { ...row });
    return writeMapRows(up, rows);
  }
  const nodes = [...list(up)];
  if (index < 0 || index >= nodes.length) return up;
  nodes.splice(index + 1, 0, structuredClone(nodes[index]));
  return setPathRaw(up, ['nodes'], nodes);
}

/** Addresses in pasted text: separated by line breaks, commas or spaces. */
export function parseNodeList(text: string): NodeRow[] {
  return text
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((addr) => parseAddr(addr));
}

/** Whether pasted text reads as addresses (several, or one with a port) rather than a host being typed. */
export function isNodeList(text: string): boolean {
  const trimmed = text.trim();
  return /[\s,]/.test(trimmed) || parseAddr(trimmed).port !== undefined;
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
