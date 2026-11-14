# apiseven Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A full-featured replacement for APISIX's built-in `/ui`: every Admin API resource editable, a sortable/configurable routes list, tabbed lock-by-default editors, schema-generated plugin forms; shipped as a static export and a Docker image.

**Architecture:** One React SPA (`web/`) that talks to the APISIX Admin API directly, driven by a resource registry so list and editor pages are generic. A stdlib-only Go server (`server/`) embeds the build and reverse-proxies `/apisix/admin/*` for Docker mode. A local APISIX + etcd (`dev/`) is the test target.

**Tech Stack:** React 19, TypeScript (strict), Vite, React Router (hash mode), TanStack Query, TanStack Table + TanStack Virtual, Radix UI primitives, CodeMirror 6, Ajv 8, Vitest + Testing Library, Playwright, Go 1.24 stdlib, Docker.

**Spec:** `docs/superpowers/specs/2026-11-14-apisix-dashboard-design.md`. Read it before any task.

## Global Constraints

- Coding subagents run on **Opus 5.5** (`model: "opus"`). Owner's instruction.
- Tasks run one at a time, so commit directly on `main` (owner's instruction). Never `git push`, never open a PR. Commit messages in English, with **no `Co-Authored-By` trailer, no Claude session link, and no "Generated with/by Claude" line** of any kind.
- Reference source (read-only, never copy UI structure): `~/apiseven-ref/apisix` (3.20), `~/apiseven-ref/apisix-dashboard`. When a field list or endpoint behaviour is in doubt, read `apisix/schema_def.lua` and `apisix/admin/*.lua`; the plan does not enumerate every field.
- No Ant Design, no Mantine, no Monaco. Own components on Radix + CSS variables.
- Contrast: every text/background token pair ≥ 4.5:1 in both themes. Locked fields use the body text colour; never `opacity` or disabled styling to show "read-only" or "off".
- Hosts, URIs, IDs, addresses render in monospace.
- Static build must work from any path: Vite `base: './'`, hash routing, no absolute asset URLs.
- Saving never drops fields the form doesn't model. Save strips `create_time`/`update_time` at top level and inside `upstream` and each `plugins.*`.
- All user-visible strings come from `web/src/i18n/en.ts` via `t(key)`.
- Dev admin key: `apiseven-dev-admin-key`. Dev Admin API: `http://127.0.0.1:9180`. Dev gateway: `http://127.0.0.1:9080`.
- Each task ends with `cd web && npm run check` green (`tsc -b && eslint . && vitest run`), then a commit.

## Review Focus

1. **Unmodelled fields.** A route loaded with a field the form doesn't know (e.g. `"x_future": {"a":1}`), edited in the form and saved, must still contain it. → test in Task 7.
2. **Schemas the form generator can't render.** Every plugin schema from 3.20 must render without throwing, and a value containing keys outside the rendered form must come back unchanged. → test in Task 8.
3. **Awkward IDs.** Consumer usernames, secret IDs (`vault/my id`), and IDs with `/ ? # %` or spaces must be URL-encoded in requests and in hash routes, and round-trip. → test in Task 2 and Task 3.
4. **API goes away mid-session.** 401 after a key is rotated, network failure, or a non-JSON response (e.g. an nginx 502 page) must show a clear message, never a blank page or an unhandled rejection. → test in Task 2 and Task 3.
5. **Empty and large instances.** Zero objects shows an empty state with a Create button; 3,000 routes sort and filter without rendering 3,000 DOM rows. → test in Task 5.
6. **`host` vs `hosts`, `uri` vs `uris`.** APISIX rejects both forms set at once. The form must write exactly one of each pair whatever the loaded shape was. → test in Task 11.

---

## File Structure

```
dev/compose.yaml, dev/apisix-config.yaml, dev/seed.mjs      local APISIX 3.x + etcd, sample data
web/package.json, vite.config.ts, tsconfig*.json, eslint.config.js, index.html
web/src/main.tsx, App.tsx
web/src/i18n/en.ts, index.ts                 t(key, vars?)
web/src/styles/tokens.css, base.css          design tokens, light + dark
web/src/styles/contrast.test.ts
web/src/api/types.ts, client.ts, errors.ts   Admin API client
web/src/api/sanitize.ts                      stripTimestamps
web/src/api/hooks.ts                         TanStack Query hooks
web/src/connection/store.ts, ConnectPage.tsx connections in local/sessionStorage
web/src/shell/Shell.tsx, Sidebar.tsx, Header.tsx, CommandPalette.tsx
web/src/ui/*.tsx                             Button, Input, Textarea, Select, Switch, Checkbox, Tabs,
                                             Dialog, Menu, Badge, Toast, Tooltip, TagInput, KeyValueInput,
                                             Field, CodeEditor, LockContext
web/src/table/DataTable.tsx, tableState.ts, ColumnsMenu.tsx, filter.ts
web/src/resources/registry.ts                ResourceDef for all 13 kinds
web/src/resources/resolve.ts                 hosts, upstream summary, SSL match, references
web/src/resources/<kind>/columns.tsx, tabs.tsx   per-resource columns and editor tabs
web/src/pages/ListPage.tsx, EditorPage.tsx   generic pages driven by the registry
web/src/editor/EditorFrame.tsx, draft.ts, save.ts, ConflictDialog.tsx, JsonTab.tsx
web/src/schema-form/SchemaForm.tsx, analyze.ts, fields/*.tsx
web/src/plugins/PluginsTab.tsx, PluginCard.tsx, PluginPicker.tsx, MetaForm.tsx, summary.ts, validate.ts
web/src/upstream/UpstreamForm.tsx, NodesTable.tsx, HealthChecks.tsx
web/e2e/*.spec.ts, playwright.config.ts
server/main.go, main_test.go, go.mod         static + proxy
Dockerfile, compose.yaml, README.md, .gitignore
```

---

### Task 1: Dev APISIX, scaffold, tokens

**Files:** Create `dev/compose.yaml`, `dev/apisix-config.yaml`, `dev/seed.mjs`, `.gitignore`, everything under `web/` needed to boot (`package.json`, Vite/TS/ESLint config, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/i18n/*`, `src/styles/*`).

**Interfaces — Produces:**
- `docker compose -f dev/compose.yaml up -d` → etcd + the newest released `apache/apisix:3.*-debian` tag (pin the exact tag), Admin API on `127.0.0.1:9180`, gateway on `127.0.0.1:9080`, admin key `apiseven-dev-admin-key`, plus a viewer key `apiseven-dev-viewer-key`, `allow_admin: [0.0.0.0/0]`, stream proxy enabled on TCP 9100 (so stream routes and stream plugins work).
- `node dev/seed.mjs [--reset]` → idempotently creates sample data via the Admin API: ≥8 routes (mix of `host`/`hosts`, `uri`/`uris`, one disabled, one bound to a service, one with `upstream_id`, one with inline upstream, several plugins), 2 upstreams, 2 services, 2 consumers with a key-auth credential, 1 consumer group, 1 self-signed SSL, 1 global rule, 1 plugin config, 1 proto, 1 stream route. `--reset` deletes everything first.
- `npm run dev | build | check | test` in `web/`.
- `t(key: string, vars?: Record<string, string | number>): string` from `src/i18n`.
- CSS variables in `tokens.css` under `:root` and `:root[data-theme="dark"]`: `--bg`, `--bg-raised`, `--bg-sunken`, `--text`, `--text-2`, `--border`, `--border-strong`, `--accent`, `--accent-text`, `--ok`, `--ok-bg`, `--warn`, `--warn-bg`, `--danger`, `--danger-bg`, `--neutral-bg`, `--focus`, `--font-sans`, `--font-mono`, `--radius`, spacing `--s1`…`--s6`.

- [ ] **Step 1:** Write `dev/compose.yaml` + `dev/apisix-config.yaml`; run `docker compose -f dev/compose.yaml up -d`; verify `curl -s -H 'X-API-KEY: apiseven-dev-admin-key' http://127.0.0.1:9180/apisix/admin/routes` returns JSON with `"total"`.
- [ ] **Step 2:** Write `dev/seed.mjs` (Node 22 `fetch`, no deps); run it twice; verify the route total is the same after the second run.
- [ ] **Step 3:** Scaffold `web/` (Vite React-TS, strict TS, ESLint flat config, Vitest with jsdom + Testing Library). `App.tsx` renders the text `apiseven`.
- [ ] **Step 4:** Write failing `src/styles/contrast.test.ts`: parse `tokens.css`, and for both themes assert WCAG contrast ≥ 4.5 for `--text`/`--bg`, `--text`/`--bg-raised`, `--text`/`--bg-sunken`, `--text-2`/`--bg`, `--text-2`/`--bg-raised`, `--accent-text`/`--accent`, `--ok`/`--ok-bg`, `--warn`/`--warn-bg`, `--danger`/`--danger-bg`, `--text`/`--neutral-bg`; and ≥ 3 for `--border-strong`/`--bg`.
- [ ] **Step 5:** Write `tokens.css` + `base.css` until the test passes. Run `npm run check`.
- [ ] **Step 6:** Commit `chore: dev APISIX, web scaffold, design tokens`.

### Task 2: Admin API client

**Files:** Create `web/src/api/types.ts`, `errors.ts`, `client.ts`, `sanitize.ts`, `hooks.ts`, tests beside each.

**Interfaces — Produces:**
```ts
export type Kind = 'routes'|'services'|'upstreams'|'consumers'|'credentials'|'consumer_groups'|'ssls'
  |'global_rules'|'plugin_configs'|'plugin_metadata'|'protos'|'secrets'|'stream_routes';
export type Obj = Record<string, unknown>;
export interface Item<T = Obj> { id: string; value: T; modifiedIndex?: number; createdIndex?: number }
export interface Connection { id: string; name: string; baseUrl: string; key?: string }  // baseUrl ends before /apisix/admin
export interface Parent { consumer: string }                       // only for kind 'credentials'
export class ApiError extends Error { kind: 'auth'|'network'|'http'|'parse'; status?: number; errorMsg?: string }

export class AdminClient {
  constructor(conn: Connection, fetchImpl?: typeof fetch);
  list(kind: Kind, parent?: Parent): Promise<Item[]>;              // pages with page_size=500 until done
  get(kind: Kind, id: string, parent?: Parent): Promise<Item>;
  create(kind: Kind, body: Obj, id?: string, parent?: Parent): Promise<Item>;  // POST when no id and kind supports it, else PUT
  replace(kind: Kind, id: string, body: Obj, parent?: Parent): Promise<Item>;  // PUT
  patch(kind: Kind, id: string, body: Obj): Promise<Item>;
  remove(kind: Kind, id: string, parent?: Parent): Promise<void>;
  ping(): Promise<{ version?: string }>;                           // GET routes?page_size=10; version from Server header
  pluginNames(subsystem?: 'http'|'stream'): Promise<string[]>;
  pluginSchema(name: string, opts?: { subsystem?: 'stream'; consumer?: boolean }): Promise<Obj>;
  allPlugins(): Promise<Record<string, PluginInfo>>;               // GET plugins?all=true, cached per client
  supports(kind: Kind): Promise<boolean>;                          // false when the list endpoint 404s
}
export interface PluginInfo { schema: Obj; consumer_schema?: Obj; metadata_schema?: Obj; priority?: number; type?: string; scope?: string }
export function stripTimestamps(body: Obj): Obj;                   // sanitize.ts
// hooks.ts
export function useClient(): AdminClient;
export function useList(kind: Kind, parent?: Parent): UseQueryResult<Item[], ApiError>;
export function useItem(kind: Kind, id: string | undefined, parent?: Parent): UseQueryResult<Item, ApiError>;
export function useAllPlugins(): UseQueryResult<Record<string, PluginInfo>, ApiError>;
export const queryKeys: { list(kind: Kind, parent?: Parent): unknown[]; item(kind: Kind, id: string, parent?: Parent): unknown[] };
```
`Item.id`: `value.id`, except consumers → `value.username`, plugin_metadata → plugin name (last key segment), secrets → `<manager>/<id>`. Per-kind quirks (consumers have no POST/PATCH, secrets no POST, protos no PATCH, credentials live under `/consumers/{username}/credentials`) are a table inside `client.ts`; confirm each against `apisix/admin/*.lua`.

- [ ] **Step 1:** Failing unit tests with a fake `fetch`:
  - `list` requests `page=1&page_size=500`, and when `total` is 1200 requests pages 2 and 3 and returns 1200 items.
  - Every request sends `X-API-KEY` when `conn.key` is set and omits it otherwise.
  - `get('consumers','a b/c?')` requests `/apisix/admin/consumers/a%20b%2Fc%3F`; `get('secrets','vault/my id')` requests `/apisix/admin/secrets/vault/my%20id`; `list('credentials',{consumer:'jo e'})` requests `/apisix/admin/consumers/jo%20e/credentials`.
  - 401 → `ApiError.kind === 'auth'`; fetch rejecting → `'network'`; 400 with `{"error_msg":"x"}` → `kind 'http'`, `errorMsg 'x'`; 502 with an HTML body → `kind 'parse'` with `status 502`.
  - `create('consumers', {username:'u'})` uses PUT to `/consumers`; `create('routes', body)` uses POST; `create('routes', body, 'r1')` uses PUT `/routes/r1`.
  - `stripTimestamps` removes `create_time`/`update_time` at top level, in `upstream`, and in every `plugins.*`, and leaves all else deep-equal.
  - `supports('credentials')` is false on a 404.
- [ ] **Step 2:** Run tests; expect failures.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Add `client.live.test.ts` (skipped unless `APISIX_LIVE=1`): against the dev APISIX, create → get → replace → remove a route, and `allPlugins()` includes `limit-count` with a `schema`. Run `APISIX_LIVE=1 npx vitest run src/api/client.live.test.ts`; expect pass.
- [ ] **Step 5:** `npm run check`; commit `feat: Admin API client`.

### Task 3: UI kit, connection, shell

**Files:** Create `web/src/ui/*`, `web/src/connection/*`, `web/src/shell/Shell.tsx`, `Sidebar.tsx`, `Header.tsx`; modify `App.tsx`.

**Interfaces — Consumes:** Task 2 client/hooks. **Produces:**
```ts
// ui/LockContext.tsx
export const LockProvider: FC<{ locked: boolean; children: ReactNode }>;
export function useLocked(): boolean;       // false outside a provider
// ui: every input takes the native props plus `label?`, `help?`, `error?`; when useLocked() is true it
// renders its value as plain full-contrast text (class `ro-value`, never `disabled`, never reduced opacity),
// `—` when empty.
export { Button, Input, NumberInput, Textarea, Select, Switch, Checkbox, Tabs, Dialog, ConfirmDialog, Menu,
         Badge, Tooltip, TagInput, KeyValueInput, Field, CodeEditor, toast };
// CodeEditor: { value: string; onChange(v: string): void; language: 'json'|'yaml'|'lua'|'pem'|'proto'|'text';
//               jsonSchema?: Obj; readOnly?: boolean; minLines?: number; maxLines?: number }
// connection/store.ts
export function useConnections(): { list: Connection[]; active?: Connection; add(c: Omit<Connection,'id'>, remember: boolean): void;
                                    remove(id: string): void; setActive(id: string): void; serverManaged: boolean };
// routes (hash): #/connect, #/:kind, #/:kind/new, #/:kind/:id, #/consumers/:username/credentials/:id|new
export function pathFor(kind: Kind, id?: string, parent?: Parent): string;   // encodes ids
```
On boot fetch `./config.json`; if it returns `{adminBase, keyRequired}` the connection is server-managed (`baseUrl` = page origin + prefix, key only asked when `keyRequired`). A 404 or non-JSON means static mode. `remember: false` stores the key in `sessionStorage`.

Sidebar groups and order are in the spec ("Shell and look"); entries whose `client.supports(kind)` is false are hidden; each shows the list count. Header: connection switcher, APISIX version, theme toggle (persisted, default = system), a slot for global search (Task 16).

- [ ] **Step 1:** Failing tests:
  - `Input` inside `<LockProvider locked>` renders no `<input>` and shows the value in an element with class `ro-value`; empty value shows `—`. Same for `Select`, `Switch` (shows `On`/`Off` text), `TagInput`.
  - `pathFor('consumers','a/b')` → `/consumers/a%2Fb`; `pathFor('credentials','c1',{consumer:'jo e'})` → `/consumers/jo%20e/credentials/c1`.
  - Connect page: submitting URL + key calls `ping`; on `auth` error shows `t('connect.badKey')`; on `network` error shows a message containing both `allow_admin` and `enable_admin_cors`; on success navigates to `#/routes`.
  - With `remember: false` nothing containing the key is written to `localStorage`.
  - A query failing with `ApiError.kind === 'auth'` anywhere redirects to `#/connect` with the reason shown.
  - `config.json` → `{adminBase:'/apisix/admin', keyRequired:false}` skips the Connect page.
- [ ] **Step 2:** Run; expect failures. **Step 3:** Implement. **Step 4:** `npm run check`.
- [ ] **Step 5:** `npm run dev`, open the app, connect to the dev APISIX, confirm the sidebar counts match `dev/seed.mjs`. Commit `feat: UI kit, connect flow, app shell`.

### Task 4: Resource registry and resolvers

**Files:** Create `web/src/resources/registry.ts`, `resolve.ts`, tests.

**Interfaces — Produces:**
```ts
export interface ColumnDef { id: string; header: string; accessor(item: Item, ctx: Ctx): unknown;   // sortable/filterable value
                             cell?(item: Item, ctx: Ctx): ReactNode; defaultVisible: boolean; width?: number; mono?: boolean }
export interface TabDef { id: string; label: string; render(p: TabProps): ReactNode; fields: string[] }  // fields = top-level keys this tab owns (for error badges)
export interface TabProps { draft: Obj; setDraft(next: Obj): void; kind: Kind; isNew: boolean; ctx: Ctx; parent?: Parent }
export interface ResourceDef { kind: Kind; group: 'traffic'|'access'|'plugins'|'other'; singular: string; plural: string;
  hasStatus: boolean; nameOf(item: Item): string; columns: ColumnDef[]; tabs: TabDef[]; blank(): Obj;
  idMode: 'optional'|'required'|'fixed-list' }
export const registry: Record<Kind, ResourceDef>;
export interface Ctx { routes: Item[]; services: Item[]; upstreams: Item[]; ssls: Item[]; pluginConfigs: Item[]; consumerGroups: Item[] }
export function useCtx(): Ctx;                               // from useList; empty arrays while loading
// resolve.ts
export function routeHosts(route: Obj, ctx: Ctx): { hosts: string[]; viaService: boolean };
export function upstreamSummary(obj: Obj, ctx: Ctx): { label: string; nodes: string[]; source: 'inline'|'upstream'|'service'|'none'|'missing'; refId?: string };
export function effectivePlugins(route: Obj, ctx: Ctx): { name: string; from: 'route'|'service'|'plugin_config'; disabled: boolean }[];
export function sslForHost(host: string, ctx: Ctx): { item: Item; notAfter: number } | undefined;   // exact SNI, else one-level wildcard
export function referencesTo(kind: Kind, id: string, ctx: Ctx): { kind: Kind; id: string; name: string }[];
```
`upstream.nodes` may be an object map or an array of `{host,port,weight}`; discovery upstreams summarise as `<discovery_type>:<service_name>`. Columns and tabs for each kind start as an ID + name pair and a single JSON tab; later tasks replace them.

- [ ] **Step 1:** Failing tests for `resolve.ts`: route with own `hosts` → not via service; no host but service with `hosts` → `viaService: true`; nodes as map and as array give the same `nodes`; `upstream_id` pointing nowhere → `source: 'missing'`; discovery → `consul:name`; `sslForHost('a.example.org')` matches SNI `*.example.org` but `a.b.example.org` does not; `referencesTo('upstreams','u1')` returns routes, services and stream routes using it; `referencesTo('plugin_configs', …)` and `('services', …)` and `('consumer_groups', …)` likewise.
- [ ] **Step 2–4:** Run, implement, `npm run check`. Commit `feat: resource registry and resolvers`.

### Task 5: DataTable and generic list page

**Files:** Create `web/src/table/*`, `web/src/pages/ListPage.tsx`, tests.

**Interfaces — Consumes:** `registry`, `useList`, `useCtx`, UI kit. **Produces:**
```ts
export interface TableState { visible: string[]; order: string[]; widths: Record<string, number>;
  sort: { id: string; desc: boolean }[]; pageSize: 25|50|100|200; density: 'comfortable'|'compact' }
export function useTableState(kind: Kind, columns: ColumnDef[]): [TableState, (patch: Partial<TableState>) => void, () => void /*reset*/];
   // persisted at localStorage `apiseven.table.<kind>`; unknown column ids in storage are dropped, new columns appended
export function matchesQuery(item: Item, query: string): boolean;   // space-separated terms, all must match somewhere in JSON.stringify(value), case-insensitive
export const DataTable: FC<{ kind: Kind; items: Item[]; columns: ColumnDef[]; ctx: Ctx;
  rowActions(item: Item): MenuItem[]; bulkActions?: BulkAction[]; toolbarExtra?: ReactNode; groupBy?: (item: Item) => string[] }>;
export const ListPage: FC<{ kind: Kind; parent?: Parent }>;
```
Behaviour: click header sorts, shift-click adds a secondary sort; Columns menu (show/hide, drag reorder, reset); search box focused by `/`; row checkboxes with select-all-filtered; rows virtualised (TanStack Virtual) inside a paged view; empty state with a Create button; row actions Edit, Duplicate, View JSON, Delete. Delete opens `ConfirmDialog` listing `referencesTo(...)` first. Kinds with `hasStatus` get a status toggle cell that PATCHes `{status}` and bulk Enable/Disable. Sorting: numbers numerically, strings with `localeCompare(…, {numeric: true})`, arrays by their joined string, empty values last in both directions.

- [ ] **Step 1:** Failing tests:
  - Sort by a column, then shift-click another: order matches a hand-computed expectation; empties are last ascending and descending.
  - Hiding a column and reordering persists across remount (read back from `localStorage`); a stale stored column id is ignored.
  - `matchesQuery` with `"example nginx"` matches only items containing both terms.
  - 3,000 items: fewer than 200 `tr` elements are in the DOM; sorting still orders all 3,000 (check first and last page).
  - Zero items: the empty state and a Create link to `#/<kind>/new` are shown.
  - Delete on an upstream used by two routes lists both route names in the dialog.
  - Bulk disable on three selected routes issues three PATCH calls with `{status: 0}`.
- [ ] **Step 2–4:** Run, implement, `npm run check`. Commit `feat: sortable configurable data table and list page`.

### Task 6: Routes list

**Files:** Create `web/src/resources/routes/columns.tsx`, test; modify `registry.ts`, `ListPage.tsx` (group toggle).

**Interfaces — Consumes:** Task 4 resolvers, Task 5 table. **Produces:** `routeColumns: ColumnDef[]`.

Columns (★ = default visible, in this order): ★status, ★name, ★hosts, ★uris, ★methods (`ANY` when unset), ★upstream, ★plugins (from `effectivePlugins`, inherited ones marked), ★updated (relative, absolute in tooltip); id, desc, priority, service, plugin_config, labels, remote_addrs, vars (count), created, ssl_expiry (soonest among the route's hosts), timeout, websocket. Hosts show a `via service` tag when inherited. Upstream/service/plugin-config cells link to that object. Quick-filter chips: status, plugin (multi-select of plugins in use), service, label. "Group by host" toggle (persisted) uses `groupBy` → one group per host string, `(any host)` for none; group header shows the SSL expiry badge: days left, `--warn` under 14 days, `--danger` when expired, `—` when no cert.

- [ ] **Step 1:** Failing tests: accessor values for a route with `uri` vs `uris`, `host` vs `hosts` vs via-service; methods unset → `ANY`; plugins include service-inherited ones flagged `from: 'service'`; grouping a route with two hosts places it in two groups; expiry badge class for 10 days left is `warn`, for a past date `danger`.
- [ ] **Step 2–4:** Run, implement, `npm run check`.
- [ ] **Step 5:** In the browser against seeded data: sort by host, hide/reorder columns, reload (state kept), toggle a route's status and confirm with `curl` that `status` changed. Commit `feat: routes list`.

### Task 7: Editor frame

**Files:** Create `web/src/editor/*`, `web/src/pages/EditorPage.tsx`, tests.

**Interfaces — Consumes:** registry `tabs`, client, UI kit. **Produces:**
```ts
export function useDraft(initial: Obj): { draft: Obj; setDraft(next: Obj): void; dirty: boolean; reset(to?: Obj): void };
export function setPath(obj: Obj, path: (string|number)[], value: unknown): Obj;   // immutable; value `undefined` or '' or [] or {} deletes the key
export function getPath(obj: Obj, path: (string|number)[]): unknown;
export async function saveResource(client: AdminClient, a: { kind: Kind; id?: string; isNew: boolean; draft: Obj; original?: Item;
  parent?: Parent; force?: boolean }): Promise<{ ok: true; item: Item } | { ok: false; conflict: Item } | { ok: false; error: ApiError }>;
export const EditorFrame: FC<{ kind: Kind; id?: string; parent?: Parent; duplicateFrom?: Item }>;
export const JsonTab: FC<TabProps>;      // CodeEditor over the whole draft; invalid JSON blocks Save and shows the parse error
```
Frame behaviour is the spec's "Edit pages" section. Pinned decisions:
- Existing object → locked; **Edit** button or key `e` (ignored while typing in a field) unlocks; Save success and Discard relock. New/Duplicate → unlocked. Duplicate removes `id`, appends ` copy` to `name`.
- Tabs come from `registry[kind].tabs` plus a final `JSON` tab. Active tab is kept in the hash query (`?tab=`).
- Save: `stripTimestamps`, then `replace` (edit) or `create` (new). Before an edit save, re-`get`; if `modifiedIndex` differs from `original.modifiedIndex` and not `force`, return `conflict` → `ConflictDialog` shows a line diff of JSON (theirs vs loaded) with Overwrite / Reload.
- On `ApiError` with `errorMsg`: show it verbatim in a banner; when the message names a property that maps to a tab's `fields`, badge that tab.
- A write failing with 401/403 after reads succeeded sets a session flag → persistent "read-only key" banner.
- Dirty + navigate away or close tab → confirm.
- ⋯ menu: Duplicate, View JSON (dialog, copy button), Delete (same reference-listing confirm as lists).
- SSL save rule (spec): `saveResource` for `ssls` on edit sends `patch` with only changed top-level keys unless the draft contains `key`; then `replace`.

- [ ] **Step 1:** Failing tests:
  - Opening an existing route: no `<input>` elements in the General tab; pressing `e` produces inputs; Discard removes them again.
  - **Review Focus 1:** load `{uri:'/a', x_future:{a:1}, upstream:{…}}`, change a field through a tab's `setDraft`, save → the PUT body deep-equals the original plus the one change, including `x_future`.
  - The PUT body has no `create_time`/`update_time`.
  - Conflict: `get` returns a higher `modifiedIndex` → no PUT is sent, result is `conflict`; with `force` the PUT is sent.
  - `setPath(o, ['a','b'], '')` deletes `b`, and deletes `a` when it becomes empty.
  - Invalid JSON in the JSON tab disables Save.
  - A 400 `{"error_msg":"invalid configuration: property \"uri\" validation failed"}` shows that exact text and badges the tab owning `uri`.
  - SSL edit changing only `snis` sends PATCH `{snis:[…]}`.
- [ ] **Step 2–4:** Run, implement, `npm run check`. Commit `feat: lock-by-default tabbed editor frame`.

### Task 8: Schema form generator

**Files:** Create `web/src/schema-form/analyze.ts`, `SchemaForm.tsx`, `fields/*.tsx`, `dev/dump-schemas.mjs`, `web/src/schema-form/fixtures/plugins-3.20.json`, tests.

**Interfaces — Produces:**
```ts
export type Node =
  | { kind: 'string'; enum?: string[]; multiline: boolean; secret: boolean }
  | { kind: 'number'; integer: boolean; min?: number; max?: number }
  | { kind: 'boolean' }
  | { kind: 'object'; props: { key: string; node: Node; required: boolean; title?: string; description?: string; default?: unknown }[]; allowsExtra: boolean }
  | { kind: 'array-scalar'; item: Node } | { kind: 'array-object'; item: Node }
  | { kind: 'map'; value: Node }
  | { kind: 'variant'; options: { label: string; node: Node; matches(v: unknown): boolean }[] }
  | { kind: 'json'; schema: Obj };                                   // fallback
export function analyze(schema: Obj, opts?: { encryptFields?: string[] }): Node;   // never throws; anything unsupported → 'json'
export const SchemaForm: FC<{ schema: Obj; value: unknown; onChange(v: unknown): void; encryptFields?: string[] }>;
```
Rules: resolve local `$ref`; `enum` of strings → select; a string is `multiline` when the key or description suggests PEM/Lua/template/body or `maxLength > 256`; `secret` when listed in `encryptFields` or the key matches `/secret|password|private_key|token/i`; `oneOf`/`anyOf` → `variant` only when exactly one option `matches` any given valid value (discriminated by `required` sets or a `const`/`enum` property), else `json`; `anyOf` used purely as "at least one of these required" on an object → plain object, validation left to Ajv; `dependencies`/`if`/`then`/`else`/`not` → render the base object and leave enforcement to Ajv; `patternProperties`/`additionalProperties` schema → `map`. Defaults are placeholders and are not written unless the user changes the field. Clearing a field deletes its key. Object props render as collapsible groups, collapsed when optional and empty. The `json` node renders an inline `CodeEditor` with that sub-schema. Respects `useLocked()`.

- [ ] **Step 1:** Write `dev/dump-schemas.mjs` (saves `GET plugins?all=true` from the dev APISIX, plus `?all=true&subsystem=stream`); commit its output as the fixture.
- [ ] **Step 2:** Failing tests:
  - **Review Focus 2a:** for every plugin in the fixture, for `schema`, `consumer_schema` and `metadata_schema`: `analyze` does not throw and `<SchemaForm>` renders with value `{}`.
  - **Review Focus 2b:** for every plugin, rendering with `{__unknown: {a: [1]}, …}` and firing one field change keeps `__unknown` deep-equal in the emitted value.
  - `limit-count`: `policy` is a select with `local`, `redis`, `redis-cluster`; `count` is an integer field marked required.
  - `proxy-rewrite`: `headers` renders without falling back to JSON for the whole plugin.
  - `key-auth` consumer schema: `key` is a secret field.
  - Rendering with a default present and no user input emits no change; typing then clearing a field removes the key.
  - Fallback ratio: fewer than 15% of top-level properties across all plugin schemas analyse to `json` (print the offenders on failure).
- [ ] **Step 3–5:** Run, implement, `npm run check`. Commit `feat: JSON-schema form generator`.

### Task 9: Plugins tab

**Files:** Create `web/src/plugins/*`, tests.

**Interfaces — Consumes:** `SchemaForm`, `useAllPlugins`, UI kit. **Produces:**
```ts
export const PluginsTab: FC<{ value: Record<string, Obj> | undefined; onChange(v: Record<string, Obj> | undefined): void;
  scope: 'route'|'service'|'consumer'|'consumer_group'|'global_rule'|'plugin_config'|'stream_route'|'credential' }>;
export function validatePlugins(plugins: Record<string, Obj>, all: Record<string, PluginInfo>, scope: Scope): { plugin: string; path: string; message: string }[];
export function pluginSummary(name: string, conf: Obj): string;    // ≤ 80 chars, first few scalar key=value pairs
```
Cards: collapsible, header shows name, enable switch (writes `_meta.disable`), summary, docs link (`https://apisix.apache.org/docs/apisix/plugins/<name>/`), remove. Body: `Form | JSON` tabs over the same value plus a fixed `_meta` form (`disable`, `priority`, `filter` as JSON, `error_response`). Schema choice: `consumer`/`credential` scope uses `consumer_schema` when the plugin has one, else `schema`; `stream_route` uses stream plugins only. Picker: searchable dialog of loaded plugins not yet added, grouped by `type`/category derived from the docs sidebar in `~/apiseven-ref/apisix/docs` (builder's choice), with a one-line description; `credential` scope lists only auth plugins that have a `consumer_schema`. Validation uses Ajv 8 (`strict: false`, draft-04-tolerant via `ajv-draft-04` when `$schema` asks for it); errors appear on the card and in the Plugins tab badge, and block Save. Removing the last plugin emits `undefined`… except where the resource requires `plugins` (global rules, plugin configs), which emit `{}`.

- [ ] **Step 1:** Failing tests: adding `limit-count` from the picker creates a card with an empty form and a required-field error on `count`; filling `count`, `time_window` clears it; the JSON tab shows the same value and editing JSON updates the form; the enable switch writes `_meta.disable: true` and removes `_meta` when turned back on and otherwise empty; `consumer` scope gives `key-auth` a `key` field; `stream_route` scope picker lists no http-only plugin such as `proxy-rewrite`; `validatePlugins` flags `{'limit-count': {count: 'x'}}`.
- [ ] **Step 2–4:** Run, implement, `npm run check`. Commit `feat: plugins tab with schema forms`.

### Task 10: Upstream form and Upstreams

**Files:** Create `web/src/upstream/*`, `web/src/resources/upstreams/{columns,tabs}.tsx`, tests; modify `registry.ts`.

**Interfaces — Produces:** `UpstreamForm: FC<{ value: Obj; onChange(v: Obj): void; layout: 'tabs'|'sections' }>` (standalone editor uses its sections as tabs; inline use collapses them as sections).

Sections and fields per spec ("Upstream form"); take the full field list from `upstream` in `apisix/schema_def.lua`. Nodes editor: table of host / port / weight / priority; preserves whichever shape (map or array) was loaded, new upstreams write the array shape; a switch flips between Nodes and Service discovery (`discovery_type`, `service_name`, `discovery_args`). `hash_on`/`key` only shown for `type: chash`. Health checks: active and passive each behind an enable switch, removing the block when off. TLS: paste cert + key or pick an SSL object of `type: client` (`tls.client_cert_id`). Upstream list columns: ★name, ★type, ★nodes, ★scheme, ★used by (count from `referencesTo`), ★updated; id, desc, retries, health check on/off, labels.

- [ ] **Step 1:** Failing tests: loading map-shaped nodes and adding one keeps the map shape; array shape likewise; switching to discovery removes `nodes` and vice versa; turning active health check off deletes `checks.active` and `checks` when empty; `type: roundrobin` hides `hash_on`; changing a timeout writes all three of `connect`/`send`/`read` (APISIX requires all three).
- [ ] **Step 2–4:** Run, implement, `npm run check`. In the browser create an upstream and confirm it via `curl`. Commit `feat: upstream form and upstreams`.

### Task 11: Route editor

**Files:** Create `web/src/resources/routes/tabs.tsx`, `VarsBuilder.tsx`, tests; modify `registry.ts`.

**Interfaces — Consumes:** `UpstreamForm`, `PluginsTab`, editor frame. **Produces:** `routeTabs: TabDef[]`, `VarsBuilder: FC<{ value: unknown; onChange(v: unknown): void }>`.

Tabs per spec table. Pinned decisions:
- Hosts and URIs are tag inputs. On write: one entry → `host`/`uri`, several → `hosts`/`uris`, none → neither; the other key of each pair is always deleted. Same for `remote_addr`/`remote_addrs`.
- Methods: checkbox row of the nine HTTP methods APISIX accepts; none ticked = any (key removed).
- Upstream tab: radio `Service's upstream` / `Existing upstream` / `Inline`; switching removes the other of `upstream_id`/`upstream`. A service picker (`service_id`) sits above it. Pickers are searchable selects showing name + ID with a link to the object.
- Plugins tab: `PluginsTab scope="route"` plus a `plugin_config_id` picker, and a read-only list of plugins inherited from the service / plugin config.
- `VarsBuilder`: rows of variable / operator / value for flat `[[var, op, val], …]` lists; anything nested or with logic operators falls back to a JSON editor.
- Advanced: `timeout` (all three or none), `enable_websocket`, `filter_func`, `script` (Lua editors).
- New routes default to `{ uri: '/*', status: 1 }` with the upstream radio on Inline.

- [ ] **Step 1:** Failing tests:
  - **Review Focus 6:** loaded with `hosts: ['a']` → after any edit the body has `host: 'a'` and no `hosts`; adding a second host gives `hosts` and no `host`; removing all gives neither. Same for URIs.
  - Switching the upstream radio from Inline to Existing deletes `upstream` and sets `upstream_id`.
  - `VarsBuilder` round-trips `[['arg_id','==','1'],['http_x','~~','^a']]`; given `[['OR', […], […]]]` it shows the JSON fallback and emits the value unchanged.
  - No methods ticked → `methods` absent.
- [ ] **Step 2–4:** Run, implement, `npm run check`.
- [ ] **Step 5:** In the browser: create a route to `httpbin.org:80` with `proxy-rewrite`, then `curl -i http://127.0.0.1:9080/<uri> -H 'Host: <host>'` returns the upstream's response. Commit `feat: route editor`.

### Task 12: Services and stream routes

**Files:** Create `web/src/resources/services/*`, `web/src/resources/stream_routes/*`, tests; modify `registry.ts`.

Service tabs: General (name, desc, labels, hosts, `enable_websocket`), Upstream (Existing / Inline), Plugins (`scope="service"`), Routes (embedded `DataTable` of routes and stream routes with this `service_id`, plus "New route in this service" which opens `#/routes/new?service_id=<id>`; the route editor pre-fills it). Service columns: ★name, ★hosts, ★upstream, ★plugins, ★routes (count), ★updated; id, desc, labels.
Stream route tabs: General (name, desc, labels), Matching (`server_addr`, `server_port`, `remote_addr`, `sni`), Upstream (Service / Existing / Inline), Plugins (`scope="stream_route"`), plus `protocol` in Advanced. Columns: ★name/id, ★server_addr, ★server_port, ★sni, ★remote_addr, ★upstream, ★plugins, ★updated.

- [ ] **Step 1:** Failing tests: the service Routes tab lists only routes with that `service_id`; `#/routes/new?service_id=s1` yields a draft with `service_id: 's1'`; the stream route Plugins picker offers only stream plugins; stream route `server_port` writes a number.
- [ ] **Step 2–4:** Run, implement, `npm run check`. Create one of each in the browser. Commit `feat: services and stream routes`.

### Task 13: Consumers, credentials, consumer groups

**Files:** Create `web/src/resources/consumers/*`, `credentials/*`, `consumer_groups/*`, tests; modify `registry.ts`, router for nested credential routes.

Consumer tabs: General (`username`, editable only when new; desc, labels, `group_id` picker), Plugins (`scope="consumer"`), Credentials (embedded list for this consumer with create/edit/delete; hidden when `supports('credentials')` is false). Credential editor: General (id, name, desc, labels) and Plugins (`scope="credential"`, exactly one auth plugin). Consumer columns: ★username, ★group, ★plugins, ★credentials (count, lazy), ★updated; desc, labels. Consumer group tabs: General, Plugins (`scope="consumer_group"`), Consumers (members list). Secret plugin fields are masked with a reveal toggle in both locked and unlocked states.

- [ ] **Step 1:** Failing tests: the username input is plain text on an existing consumer even when unlocked; creating a consumer PUTs to `/consumers` with `username` in the body; the credential editor for consumer `jo e` saves to `/consumers/jo%20e/credentials/<id>`; a `key-auth` credential's `key` is rendered masked until reveal is clicked; the Credentials tab is absent when `supports` is false.
- [ ] **Step 2–4:** Run, implement, `npm run check`. In the browser: create a consumer + key-auth credential, add `key-auth` to a route, confirm 401 without and 200 with the `apikey` header via `curl`. Commit `feat: consumers, credentials, consumer groups`.

### Task 14: SSL certificates

**Files:** Create `web/src/resources/ssls/*`, `web/src/resources/ssls/parseCert.ts`, tests; modify `registry.ts`.

**Interfaces — Produces:** `parseCert(pem: string): { subject: string; issuer: string; sans: string[]; notBefore: number; notAfter: number; fingerprint: string } | undefined` (pure JS X.509 parsing, e.g. `@peculiar/x509`).

Tabs: Certificate (parsed details of `cert`; "private key: stored, not shown"; **Replace certificate** opens a dialog to paste or upload cert + key, checks the pair parses, and puts both in the draft; extra cert/key pairs in `certs`/`keys`), SNIs (tag input; a "Use SANs from certificate" button), Client mTLS (`client.ca`, `client.depth`, `client.skip_mtls_uri_regex`), General (`type` server/client, `status`, labels, `ssl_protocols`). New SSL requires cert + key. Columns: ★status, ★snis, ★expires (days left with the same warn/danger badge rules as Task 6), ★issuer, ★type, ★used by hosts (count of route hosts matching), ★updated; id, subject, fingerprint, labels.

- [ ] **Step 1:** Failing tests: `parseCert` on the seeded self-signed cert returns its SANs and `notAfter`; garbage returns `undefined`; editing SNIs only → PATCH without `cert`/`key`; after Replace → PUT containing `cert` and `key`; Save is disabled on a new SSL until both cert and key are present; "Use SANs" fills `snis` from the cert.
- [ ] **Step 2–4:** Run, implement, `npm run check`. In the browser upload a cert and confirm `curl -k --resolve` to the gateway's HTTPS port presents it (enable 9443 in `dev/compose.yaml` if not already). Commit `feat: SSL certificates`.

### Task 15: Global rules, plugin configs, plugin metadata, protos, secrets

**Files:** Create `web/src/resources/{global_rules,plugin_configs,plugin_metadata,protos,secrets}/*`, tests; modify `registry.ts`.

- Global rule: tabs Plugins (`scope="global_rule"`), General (id). Columns: ★id, ★plugins, ★updated.
- Plugin config: General (name, desc, labels), Plugins (`scope="plugin_config"`), Used by (routes). Columns: ★name, ★plugins, ★used by, ★updated.
- Plugin metadata: the list shows every plugin that has a `metadata_schema` (from `allPlugins`) with a Configured / Not set badge; the editor is a `SchemaForm` over that schema with Form | JSON, ID fixed to the plugin name; Delete resets it. If `allPlugins` fails, list existing metadata entries and edit as JSON.
- Proto: General (id, name, desc, labels), Content (`CodeEditor language="proto"` + upload of `.proto` or base64 `.pb`). Columns: ★id, ★name, ★size, ★updated.
- Secret: create picks manager `vault`/`aws`/`gcp` and an ID; form is a `SchemaForm` over that manager's schema (from `apisix/secret/*.lua`; dump them into a fixture with Task 8's script or hand-write the three schemas from source); secret fields masked. Columns: ★id (`manager/id`), ★manager, ★endpoint (uri/region), ★updated.

- [ ] **Step 1:** Failing tests: plugin metadata list includes `http-logger` as "Not set" when nothing is stored and saving PUTs to `/plugin_metadata/http-logger`; a global rule with all plugins removed still sends `plugins: {}`; a secret saves to `/secrets/vault/<id>` and its `token` is masked; proto upload of a text file fills `content`.
- [ ] **Step 2–4:** Run, implement, `npm run check`. Create one of each in the browser. Commit `feat: remaining resources`.

### Task 16: Global search and polish pass

**Files:** Create `web/src/shell/CommandPalette.tsx`, test; modify `Header.tsx`.

`Cmd/Ctrl-K` opens a palette searching all cached lists by name, ID, host, URI, SNI, username; results grouped by kind, Enter navigates; also offers "New <kind>" actions and "Switch connection". Then a pass over every page in both themes at 1280 and 1024 wide: no horizontal page scroll, no clipped text without a tooltip, focus rings visible, every icon-only button has an `aria-label`.

- [ ] **Step 1:** Failing tests: typing a host finds its route; typing a consumer username finds the consumer; Enter navigates to `pathFor(...)`; `Ctrl-K` opens and `Esc` closes.
- [ ] **Step 2–4:** Run, implement, `npm run check`. Commit `feat: global search`.

### Task 17: Go server, Docker image, README

**Files:** Create `server/main.go`, `server/main_test.go`, `server/go.mod`, `Dockerfile`, `compose.yaml`, `README.md`.

**Interfaces — Produces:** env vars exactly as in the spec table (`APISIX_ADMIN_URL`, `APISIX_ADMIN_KEY`, `APISIX_ADMIN_KEY_FILE`, `LISTEN` default `:8080`, `BASIC_AUTH_USER`, `BASIC_AUTH_PASSWORD`, `BASIC_AUTH_PASSWORD_FILE`); `GET /config.json` → `{"adminBase":"/apisix/admin","keyRequired":<true when no server key>}`; `GET /healthz` → 200; `/apisix/admin/*` reverse-proxied (`httputil.ReverseProxy`), injecting `X-API-KEY` when a server key is set and stripping any client-sent one in that case; everything else serves the embedded `web/dist` (`go:embed`), with `index.html` for `/`. Security headers on static responses (`X-Content-Type-Options`, `Referrer-Policy: no-referrer`, a CSP allowing self + inline styles + `connect-src *`). Server key set without basic auth → one `WARNING` log line at start. Dockerfile: node build stage → Go build stage → `gcr.io/distroless/static-debian12:nonroot`. `compose.yaml` binds `127.0.0.1:8080`, `read_only: true`. README: what it is, screenshots placeholder, static mode (unzip `web/dist`, any file server, `allow_admin`/CORS note), Docker mode, env table, development (`dev/compose.yaml`, seed, `npm run dev`, tests).

- [ ] **Step 1:** Failing Go tests with `httptest`: `/config.json` reports `keyRequired` correctly for both configurations; the proxy forwards path, query, method and body; with a server key the upstream sees that key even if the client sent another; without one the client's key passes through; basic auth set → 401 without credentials on `/`, `/config.json` and `/apisix/admin/routes`, 200 on `/healthz`; unknown static path → 404, `/` → index.
- [ ] **Step 2:** Run `cd server && go test ./...`; expect failures. **Step 3:** Implement. **Step 4:** Tests pass; `go vet ./...` clean.
- [ ] **Step 5:** `docker build -t apiseven:dev .` then run it on the dev APISIX's Docker network with `APISIX_ADMIN_URL` set; open `http://127.0.0.1:8080`, confirm the routes list loads without a Connect page when a server key is set, and with one when it isn't.
- [ ] **Step 6:** `cd web && npm run build && npx serve dist -l 5055` (static mode) → connect with URL + key works. Commit `feat: Go server, Docker image, README`.

### Task 18: End-to-end suite

**Files:** Create `web/playwright.config.ts`, `web/e2e/{connect,routes-list,route-editor,plugins,resources,ssl,proxy-mode}.spec.ts`; add `npm run e2e`.

Runs against `dev/compose.yaml` after `node dev/seed.mjs --reset`, Chromium only, against `vite preview`; `proxy-mode.spec.ts` runs against the Docker image.

- [ ] **Step 1:** Write the specs:
  - connect: bad key → error; good key → routes list; viewer key → list loads, a save shows the read-only banner.
  - routes-list: sort by host ascending/descending matches the seeded order; hide a column, reload, still hidden; search narrows rows; group by host shows `(any host)`; bulk disable two routes then verify via the Admin API.
  - route-editor: page opens locked (no inputs); Edit → change URI → Save → relocked and the Admin API shows the new URI; create a route and `fetch` through the gateway returns the upstream response; dirty navigate-away prompts.
  - plugins: add `limit-count` via the form, switch to JSON and see the same values, save, and a burst of requests through the gateway returns a 503/429.
  - resources: for each of the other kinds, create → appears in the list → edit one field → delete → gone.
  - ssl: upload cert + key, edit SNIs without re-entering the key, replace the certificate.
  - proxy-mode: the Docker image with a server key loads routes with no Connect page.
  - axe-core scan of the routes list and route editor in both themes reports no `color-contrast` violations.
- [ ] **Step 2:** Run `npm run e2e`; fix what fails in the app (not by weakening the specs).
- [ ] **Step 3:** `npm run check && npm run e2e` both green. Commit `test: end-to-end suite`.
