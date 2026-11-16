// The routes list columns. Accessors return plain values for sorting (strings, numbers, string
// arrays); cells present them (../cells.tsx). The status column is the table's own (DataTable puts
// it first for kinds with a status), so it is not defined here.
import type { ReactNode } from 'react';
import { isObj } from '../../api/sanitize';
import type { Obj } from '../../api/types';
import { t } from '../../i18n';
import { Empty, Lines } from '../../table/cells';
import { HostsCell, IdCell, LabelChips, MethodChips, NameDescCell, PluginChips, RefCell, TimeCell, UpstreamCell, type PluginChip } from '../cells';
import type { Ctx } from '../ctx';
import { ExpiryBadge } from '../expiry';
import type { ColumnDef } from '../registry';
import { effectivePlugins, labelPairs, nameOfValue, resolveRef, routeHosts, routeHostsLoading, routeHostsUnknown, routeScript, sslExpiries, sslForHost, upstreamSummary, type EffectivePlugin } from '../resolve';
import { methodsOf } from './methods';

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v !== '') : [];
}

/** The plural field when it has entries, else the singular one (`uris`/`uri`, `remote_addrs`/`remote_addr`). */
function oneOrMany(value: Obj, many: string, one: string): string[] {
  const list = strings(value[many]);
  if (list.length > 0) return list;
  return typeof value[one] === 'string' && value[one] !== '' ? [value[one]] : [];
}

const LOGICAL = new Set(['AND', 'OR', '!AND', '!OR']);

/** Conditions in a `vars` expression: leaves, counting through nested AND / OR (lua-resty-expr). */
function countConditions(expr: unknown[]): number {
  const [head, ...rest] = expr;
  if (typeof head === 'string' && LOGICAL.has(head)) return countConditions(rest);
  if (expr.every(Array.isArray)) return expr.reduce<number>((sum, sub) => sum + countConditions(sub as unknown[]), 0);
  return 1;
}

function varsCount(vars: unknown): number | undefined {
  if (!Array.isArray(vars) || vars.length === 0) return undefined;
  return countConditions(vars);
}

/** The connect, send and read timeouts in seconds (`?` for one not set). */
function timeoutParts(timeout: unknown): { connect: string; send: string; read: string } | undefined {
  if (!isObj(timeout)) return undefined;
  const part = (key: string) => (typeof timeout[key] === 'number' ? String(timeout[key]) : '?');
  return { connect: part('connect'), send: part('send'), read: part('read') };
}

/** `connect/send/read` in seconds. */
function timeoutOf(timeout: unknown): string | undefined {
  const parts = timeoutParts(timeout);
  return parts && `${parts.connect}/${parts.send}/${parts.read}`;
}

/**
 * The soonest expiry (ms) among the certificates APISIX would serve for the route's hosts; where
 * several certificates share a host's SNI (APISIX serves the one it loaded first), the soonest of them.
 */
function soonestExpiry(route: Obj, ctx: Ctx): number | undefined {
  let soonest: number | undefined;
  for (const host of routeHosts(route, ctx).hosts) {
    for (const notAfter of sslExpiries(sslForHost(host, ctx))) {
      if (notAfter !== undefined && (soonest === undefined || notAfter < soonest)) soonest = notAfter;
    }
  }
  return soonest;
}

/**
 * Whether APISIX upgrades WebSocket for the route: its own `enable_websocket`, else (unset) its
 * service's, else off (apisix/init.lua 1017, 1046–1047); `loading` / `unknown` while the service's
 * setting can't be known yet / at all.
 */
function websocketOf(route: Obj, ctx: Ctx): boolean | 'loading' | 'unknown' {
  if (route.enable_websocket !== undefined) return route.enable_websocket === true;
  const service = resolveRef('services', route.service_id, ctx);
  if (!service) return false;
  if (!ctx.loaded.services) return ctx.failed.services ? 'unknown' : 'loading';
  return service.item?.value.enable_websocket === true;
}

/** A referenced object's name (else its id); undefined when the field is unset. */
export function refName(kind: 'services' | 'plugin_configs', field: unknown, ctx: Ctx): string | undefined {
  const target = resolveRef(kind, field, ctx);
  return target && (target.item ? (nameOfValue(target.item.value) ?? target.id) : target.id);
}

/**
 * The plugins that run (by default a route's, effectivePlugins), each saying where an inherited one
 * comes from; every one "not run" when `notRun` names whose script runs instead. Only an HTTP route
 * can have one (routeScript): the stream list passes none.
 */
export function pluginChips(route: Obj, ctx: Ctx, plugins: EffectivePlugin[] = effectivePlugins(route, ctx), notRun?: 'route' | 'service'): PluginChip[] {
  return plugins.map(({ name, from, disabled, noEffect }): PluginChip => {
    if (from === 'service') return { name, disabled, noEffect, notRun, from: t('cell.plugin.fromService', { name: refName('services', route.service_id, ctx) ?? '' }) };
    if (from === 'plugin_config') {
      return { name, disabled, noEffect, notRun, from: t('cell.plugin.fromPluginConfig', { name: refName('plugin_configs', route.plugin_config_id, ctx) ?? '' }) };
    }
    return { name, disabled, noEffect, notRun };
  });
}

/** The plugins cell: "loading…" while whether a service's script runs instead isn't known yet, "unknown" when it can't be. */
function pluginsCell(route: Obj, ctx: Ctx): ReactNode {
  const script = routeScript(route, ctx);
  if (script === 'loading') return <span className="cell-muted">{t('picker.loading')}</span>;
  if (script === 'unknown') return <span className="cell-muted">{t('cell.pluginsUnknown')}</span>;
  return <PluginChips plugins={pluginChips(route, ctx, undefined, script)} />;
}

const time = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

// Headers are getters, so they follow the language table at use (never spread a column). The
// default columns' widths add up, with the status, checkbox and actions columns, to the 1010px a
// 1280px window leaves beside the sidebar: a 20-character host, `10.0.2.10:8080`, two methods and
// `+N` on one line; longer values end in an ellipsis with their whole text in a title.
export const routeColumns: ColumnDef[] = [
  {
    id: 'name',
    get header() {
      return t('column.name');
    },
    accessor: (item) => nameOfValue(item.value) ?? item.id,
    cell: (item) => <NameDescCell kind="routes" item={item} />,
    defaultVisible: true,
    width: 116,
  },
  {
    id: 'hosts',
    get header() {
      return t('column.hosts');
    },
    accessor: (item, ctx) => routeHosts(item.value, ctx).hosts,
    cell: (item, ctx) => {
      const { hosts, viaService } = routeHosts(item.value, ctx);
      return <HostsCell hosts={hosts} viaService={viaService} loading={routeHostsLoading(item.value, ctx)} unknown={routeHostsUnknown(item.value, ctx)} />;
    },
    defaultVisible: true,
    width: 164,
  },
  {
    id: 'uris',
    get header() {
      return t('column.uris');
    },
    accessor: (item) => oneOrMany(item.value, 'uris', 'uri'),
    cell: (item) => <Lines lines={oneOrMany(item.value, 'uris', 'uri')} mono />,
    defaultVisible: true,
    width: 92,
  },
  {
    id: 'methods',
    get header() {
      return t('column.methods');
    },
    accessor: (item) => methodsOf(item.value),
    cell: (item) => <MethodChips methods={methodsOf(item.value)} />,
    defaultVisible: true,
    width: 104,
  },
  {
    id: 'upstream',
    get header() {
      return t('column.upstream');
    },
    accessor: (item, ctx) => {
      const summary = upstreamSummary(item.value, ctx);
      if (summary.source === 'none') return undefined;
      return summary.source === 'missing' ? t('cell.missing.upstreams', { id: summary.refId ?? '' }) : summary.label;
    },
    cell: (item, ctx) => <UpstreamCell summary={upstreamSummary(item.value, ctx)} />,
    defaultVisible: true,
    width: 122,
  },
  {
    id: 'plugins',
    get header() {
      return t('column.plugins');
    },
    accessor: (item, ctx) => effectivePlugins(item.value, ctx).map((p) => p.name),
    cell: (item, ctx) => pluginsCell(item.value, ctx),
    defaultVisible: true,
    width: 124,
  },
  {
    id: 'updated',
    get header() {
      return t('column.updated');
    },
    accessor: (item) => time(item.value.update_time),
    cell: (item) => <TimeCell epoch={item.value.update_time} />,
    defaultVisible: true,
    width: 88,
  },
  {
    id: 'id',
    get header() {
      return t('column.id');
    },
    accessor: (item) => item.id,
    cell: (item) => <IdCell id={item.id} />,
    defaultVisible: false,
    width: 160,
    mono: true,
  },
  {
    id: 'desc',
    get header() {
      return t('column.desc');
    },
    accessor: (item) => item.value.desc,
    defaultVisible: false,
    width: 220,
  },
  {
    id: 'priority',
    get header() {
      return t('column.priority');
    },
    accessor: (item) => (typeof item.value.priority === 'number' ? item.value.priority : 0),
    defaultVisible: false,
    width: 90,
  },
  {
    id: 'service',
    get header() {
      return t('column.service');
    },
    accessor: (item, ctx) => refName('services', item.value.service_id, ctx),
    cell: (item, ctx) => <RefCell kind="services" target={resolveRef('services', item.value.service_id, ctx)} />,
    defaultVisible: false,
    width: 130,
  },
  {
    id: 'plugin_config',
    get header() {
      return t('column.plugin_config');
    },
    accessor: (item, ctx) => refName('plugin_configs', item.value.plugin_config_id, ctx),
    cell: (item, ctx) => <RefCell kind="plugin_configs" target={resolveRef('plugin_configs', item.value.plugin_config_id, ctx)} />,
    defaultVisible: false,
    width: 140,
  },
  {
    id: 'labels',
    get header() {
      return t('column.labels');
    },
    accessor: (item) => labelPairs(item.value.labels).map(([key, value]) => `${key}:${value}`),
    cell: (item) => <LabelChips pairs={labelPairs(item.value.labels)} />,
    defaultVisible: false,
    width: 180,
  },
  {
    id: 'remote_addrs',
    get header() {
      return t('column.remote_addrs');
    },
    accessor: (item) => oneOrMany(item.value, 'remote_addrs', 'remote_addr'),
    defaultVisible: false,
    width: 150,
    mono: true,
  },
  {
    id: 'vars',
    get header() {
      return t('column.vars');
    },
    accessor: (item) => varsCount(item.value.vars),
    defaultVisible: false,
    width: 70,
  },
  {
    id: 'created',
    get header() {
      return t('column.created');
    },
    accessor: (item) => time(item.value.create_time),
    cell: (item) => <TimeCell epoch={item.value.create_time} />,
    defaultVisible: false,
    width: 88,
  },
  {
    id: 'ssl_expiry',
    get header() {
      return t('column.ssl_expiry');
    },
    accessor: (item, ctx) => soonestExpiry(item.value, ctx),
    cell: (item, ctx) => <ExpiryBadge notAfter={soonestExpiry(item.value, ctx)} />,
    defaultVisible: false,
    width: 160,
  },
  {
    id: 'timeout',
    get header() {
      return t('column.timeout');
    },
    accessor: (item) => timeoutOf(item.value.timeout),
    cell: (item) => {
      const parts = timeoutParts(item.value.timeout);
      if (!parts) return <Empty />;
      return (
        <span className="tbl-line mono" title={t('cell.timeout', parts)}>
          {`${parts.connect}/${parts.send}/${parts.read}`}
        </span>
      );
    },
    defaultVisible: false,
    width: 100,
  },
  {
    id: 'websocket',
    get header() {
      return t('column.websocket');
    },
    accessor: (item, ctx) => {
      const on = websocketOf(item.value, ctx);
      return typeof on === 'boolean' ? on : undefined;
    },
    cell: (item, ctx) => {
      const on = websocketOf(item.value, ctx);
      if (on === 'loading') return <span className="cell-muted">{t('picker.loading')}</span>;
      if (on === 'unknown') return <span className="cell-muted">{t('cell.websocketUnknown')}</span>;
      return t(on ? 'ui.yes' : 'ui.no');
    },
    defaultVisible: false,
    width: 110,
  },
];
