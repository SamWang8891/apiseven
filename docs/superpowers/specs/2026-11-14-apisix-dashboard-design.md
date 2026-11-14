# apiseven: an alternative dashboard for Apache APISIX

Date: 2026-11-14 · Status: approved by owner 2026-11-14

## Intent

APISIX's built-in dashboard (`/ui` on the admin port) is hard to use. The routes page is
the worst part: no sorting, no choice of columns (it can't even show the host), a faint
low-contrast look that makes state and content hard to read, and edit pages that are one
long scroll with nothing collapsible.

apiseven replaces it. It does everything `/ui` does, with full editing, and fixes those
problems. It replaces the earlier read-only `apisix-hosts` Go page.

## Goals

- **Feature parity with `/ui`** for all 13 resource types: routes, services, upstreams,
  consumers, consumer credentials, consumer groups, SSL certificates, global rules,
  plugin configs, plugin metadata, protos, secrets, stream routes. List, create, edit,
  delete for each.
- **A routes page that works**: sort by any column, choose and reorder columns
  (host, URI, methods, upstream, service, plugins, status, priority, labels, updated
  time, ID…), search/filter, clear enabled/disabled state, bulk enable/disable/delete.
- **Readable**: body text and secondary text meet WCAG AA contrast (4.5:1) against their
  background in both light and dark themes. No grey-on-grey. Read-only values look like
  values, not like disabled inputs.
- **Short edit pages**: every editor is split into tabs. Nothing requires a long scroll.
- **Plugin forms generated from schema** (decision B), with a JSON tab always available.
- **Two ways to run it** from one build:
  1. Static files: open the page, enter Admin API URL + key.
  2. Docker: a small server serves the same files and proxies the Admin API.

## Non-goals

- Metrics, traffic graphs, logs, or anything not in the Admin API.
- User accounts / RBAC inside apiseven. Access is whatever the Admin API key allows.
- Managing APISIX's `config.yaml` or restarting APISIX.
- Standalone (YAML/API-driven-standalone) mode. Targets the etcd-backed Admin API.
- Supporting APISIX 2.x. Target is 3.x; developed and tested against 3.20.

## Anti-goals

- A page that looks fine but silently drops fields it doesn't know. If a resource has
  fields the form doesn't model, saving from the form must preserve them.
- Greyed-out, low-contrast "view mode". The locked state is full contrast.
- A plugin the user can't configure because the form generator choked. JSON always works.

## Constraints

- The Admin API sends permissive CORS headers by default (`enable_admin_cors: true`,
  `Allow-Headers: *`), so the static page can call it directly.
- `allow_admin` defaults to `127.0.0.0/24`. Static mode only works from an allowed
  browser IP. Docker mode sidesteps this: only the container's IP needs allowing.
- Plugin schemas come from the running APISIX: `GET /apisix/admin/plugins/list`,
  `GET /apisix/admin/plugins/{name}` (optionally `?subsystem=stream`),
  (`/schema/plugins/{name}` is an alias); consumer-side schema via
  `?schema_type=consumer`. Metadata schemas are only available from
  `GET /apisix/admin/plugins?all=true` (deprecated but the only source in 3.20); fetch
  it once per connection and cache it, and fall back to a plain JSON editor for
  metadata if it ever disappears.
- `POST /apisix/admin/schema/validate/{resource}` checks only the bare resource schema:
  no plugin configs, no reference checks, and it is refused for viewer keys. Plugin
  configs are validated in the browser with Ajv; the real save is the final authority.
- SSL GETs never return `key` / `keys`. Other encrypted plugin fields come back decrypted.
- PUT/POST reject `create_time` / `update_time` at the top level and inside `upstream`
  and `plugins`; the save layer strips them.
- There is no conditional write; `status` exists only on routes and SSL; consumers have
  no POST/PATCH, secrets no POST, protos no PATCH. `page_size` max is 500.
- Scale (builder's call): built for up to a few thousand objects per type. Everything is
  loaded into one client cache; tables are virtualised. Tens of thousands is out of scope.
- Versions (builder's call): developed and tested on 3.20 only. Missing endpoints on
  older 3.x are detected by probing and hidden; no version matrix.
- The Admin API key is powerful. In static mode it lives in the browser.
- Repo: `~/apiseven` (github.com/SamWang8891/apiseven), Apache-2.0.
- Reference source: `~/apiseven-ref/apisix` (3.20) and `~/apiseven-ref/apisix-dashboard`.
  Use them to match fields and behaviour; do not copy the dashboard's UI structure.
- Coding is done by Opus 5.5 subagents (owner's instruction); planning by the main session.

## Approaches considered

1. **New app from scratch: React + TypeScript + Vite, static build, small Go server for
   Docker.** Chosen by the owner. Full control of the UI; schema-driven plugin forms mean
   new plugins work automatically. Most up-front work.
2. **Fork the official dashboard.** All resources on day one, but keeps the Mantine +
   Ant Design mix and the long forms the owner dislikes; upstream sync is a chore.
3. **Extend `apisix-hosts`** (server-rendered Go). Can't be a static export with a
   pasted key; schema forms would be painful. Dropped.

## Design

### Architecture

```
web/      React SPA (Vite). Builds to static files with relative asset paths,
          hash-based routing, so it runs from any path or a plain file server.
server/   Go, stdlib only. Serves web/dist (embedded) and reverse-proxies
          /apisix/admin/* to APISIX_ADMIN_URL.
Dockerfile, compose.yaml (apiseven only), dev/compose.yaml (APISIX + etcd for testing)
```

**Connection.** On first load the app shows a Connect screen: Admin API base URL + key.
It verifies with a cheap GET, then stores the connection in `localStorage` (with a
"don't remember key, this tab only" option using `sessionStorage`). Multiple saved
connections can be switched from the header (e.g. staging / prod).

**Docker mode.** The server exposes `GET /config.json`. If present the SPA uses it:
`{ "adminBase": "/apisix/admin", "keyRequired": true|false }`. Env:

| Var | Meaning |
|-----|---------|
| `APISIX_ADMIN_URL` | upstream Admin API, e.g. `http://apisix:9180` |
| `APISIX_ADMIN_KEY` / `APISIX_ADMIN_KEY_FILE` | optional. If set, the server injects `X-API-KEY` and the UI asks for nothing. If unset, the user pastes a key and the server passes it through. |
| `LISTEN` | default `:8080` |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD(_FILE)` | optional HTTP basic auth in front of everything, for when the key is server-side |

When the key is server-side and no basic auth is set, the server logs a loud warning at
start (anyone who reaches the page is admin). Default compose binds `127.0.0.1` only.

### Tech choices (builder's calls, stated)

- React 19, TypeScript, Vite. TanStack Query for data, TanStack Table for lists,
  TanStack Router or React Router in hash mode.
- Own component layer on Radix primitives + CSS variables (design tokens). No Ant Design.
  This is what makes the contrast and density rules enforceable.
- CodeMirror 6 for JSON/YAML/Lua/PEM editing (much lighter than Monaco in a static
  bundle), with JSON-schema linting and autocomplete.
- Ajv for client-side schema validation of plugin configs.
- Vitest for unit tests; Playwright for end-to-end tests against the dev APISIX.

### Shell and look

Left sidebar with the resource types grouped (Traffic: Routes, Stream Routes, Services,
Upstreams · Access: Consumers, Consumer Groups, SSL, Secrets · Plugins: Global Rules,
Plugin Configs, Plugin Metadata · Other: Protos), each with a live count. Header:
connection switcher, APISIX version, global search (Cmd/Ctrl-K: jump to any resource by
name, host, URI, or ID), theme toggle.

Dense, high-contrast, technical look: near-black text on white (and the reverse in dark
mode), monospace for hosts/URIs/IDs/addresses, colour used for state only (enabled =
solid green badge with text, disabled = solid neutral badge with text, never opacity
alone). UI language: English. Strings go through one lookup table so zh-TW can be added.

### List pages (shared table, every resource)

All rows are fetched (paging through the Admin API with `page_size=500`) and sorting,
filtering and paging happen in the browser, so sort and search are instant and cover
everything. Per-resource table state (visible columns, order, widths, sort, page size,
density) is saved in `localStorage`.

- Click a header to sort; shift-click for multi-sort.
- "Columns" menu: tick to show/hide, drag to reorder, reset to default.
- Search box matching across all visible and hidden fields; `/` focuses it.
  Quick filters as chips (status, has-plugin X, service, label).
- Row checkbox + bulk actions (delete; enable/disable where the resource has a status).
- Row actions: Edit, Duplicate, View JSON, Delete (confirm dialog naming the resource).
- Cross-links: an upstream/service/plugin-config cell links to that object.
- Delete shows what references the object first (e.g. routes using this upstream).

**Routes list**, default columns:

```
[ ] Status  Name            Host(s)              URI(s)      Methods   Upstream              Plugins            Updated   ⋯
[ ] ● ON    game-api        api.example.games    /v1/*       GET POST  backend.internal:443  cors ip-restrict   2d ago    ⋯
[ ] ○ OFF   old-wiki        wiki.example.org     /*          ANY       10.0.0.20:3000        —                  40d ago   ⋯
```

Status is a toggle that enables/disables the route in place. Host falls back to the bound
service's hosts (marked "via service"). Upstream resolves inline nodes → `upstream_id` →
service upstream, showing node addresses or the upstream name. Optional columns: ID,
description, priority, service, plugin config, labels, remote addrs, vars, created time,
SSL expiry for the host, timeout, websocket. A "Group by host" toggle gives the
`apisix-hosts` view: one group per distinct host string (wildcards like `*.example.org`
are their own group, not expanded), routes with no host under `(any host)`, a route
with several hosts appears in each. The group header shows the matching SSL object's
expiry (exact SNI, else one-level wildcard): days left, amber under 14 days, red when
expired. The old source is in `~/Downloads/apisix-hosts.tar.gz` (`main.go`) for reference.

### Edit pages (shared frame, every resource)

One page for create and edit. **Opening an existing object starts locked** (owner's
decision): nothing can be changed by accident. The sticky header shows a clear
"Locked" badge and an **Edit** button (shortcut `e`); pressing it unlocks the same page
in place, with no navigation and no layout shift. Save or Discard locks it again. Create and
Duplicate start unlocked.

Locked must not look greyed out. Locked fields render as full-contrast text values (same
colour as body text, no disabled-input styling, no reduced opacity); tabs, collapsing,
copy buttons, cross-links, JSON view and plugin cards all still work. Only the inputs
and destructive controls are inert. The status toggle in the header and in lists is
also inert while locked on the edit page (the list toggle is unaffected).

Sticky header when unlocked: name, ID, status toggle, **Save**, Discard, and a ⋯ menu
(Duplicate, View JSON, Delete).
Unsaved changes mark the tab and the Save button and trigger a leave-page warning.
Validation errors mark the tab that contains them with a count.

Every editor has a **Form ⇄ JSON** switch for the whole resource. Both edit the same
draft object. The form only writes the fields it knows; unknown fields in the draft are
kept and shown in JSON. Save sends a `PUT` of the full draft for edit (so removed fields
are really removed) and `POST`/`PUT` for create (ID optional, custom ID allowed).
Before save, the draft is validated client-side (plugin configs with Ajv); on save
APISIX's own error message is shown
verbatim next to the field when it can be mapped, otherwise in a banner.

**Route editor tabs**

| Tab | Contents |
|-----|----------|
| General | name, description, labels, status, priority, ID (create only) |
| Matching | host(s), URI(s), methods, remote addr(s), `vars` builder (with JSON fallback), `filter_func` |
| Upstream | choose: bound service / existing upstream (`upstream_id`) / inline. Inline shows the full upstream form in sub-sections |
| Plugins | plugin list (below); plugin config reference (`plugin_config_id`) |
| Advanced | timeout, `enable_websocket`, `script`, anything else |
| JSON | the whole object |

**Upstream form** (used standalone and inline): Nodes (table of host/port/weight/priority,
or service discovery: type + service name + args) · Load balancing (type, hash_on, key) ·
Health checks (active / passive, collapsed until enabled) · Connection (scheme, timeouts,
retries, retry_timeout, keepalive pool, pass_host, upstream_host) · TLS (client cert/key
or `client_cert_id`, verify).

Other editors follow the same frame with their own tabs: Service (General, Upstream,
Plugins, Routes using it), Consumer (General, Plugins, Credentials), Consumer Group,
SSL (Certificate with PEM upload/paste and parsed subject/SANs/expiry, SNIs, Client mTLS),
Global Rule, Plugin Config, Plugin Metadata (one entry per plugin that has a metadata
schema), Proto (editor + upload), Secret (vault / aws / gcp, form from schema),
Stream Route (General, Matching, Upstream, Plugins using stream-subsystem plugins).

### Plugins (decision B)

The Plugins tab lists enabled plugins as collapsible cards (name, on/off switch, one-line
summary of the config, docs link, remove). "Add plugin" opens a searchable picker of the
plugins the connected APISIX has loaded, grouped by category, hiding ones that don't
apply (e.g. consumer-only auth config on a route shows its route-side schema).

Each card has **Form | JSON** tabs editing the same value.

*Form generator.* Input: the JSON Schema from APISIX. It handles: string (plain, enum →
select, pattern, format, multi-line for long/PEM/Lua), number/integer (min/max), boolean,
object (nested group, collapsible), array of scalars (tag input), array of objects
(repeatable rows/cards), `additionalProperties`/`patternProperties` maps (key-value
editor), `default` (shown as placeholder, not written unless changed), `required`,
`description` as help text, `oneOf`/`anyOf` (variant picker when variants are
distinguishable; otherwise fallback), `dependencies` / `if-then-else` (show/hide where
simple; otherwise fallback), `encrypt_fields` → password inputs.

*Fallback.* Any sub-schema the generator can't render becomes an inline JSON editor for
just that field, schema-validated. The plugin-level JSON tab is always available and has
schema autocomplete + linting. Values the form doesn't model are never dropped.

`_meta` (disable, priority, filter, error_response) gets a fixed small form on every card.

### Errors and edge cases

- 401/403 → back to Connect with the reason. Network/CORS failure → a message that names
  `allow_admin` and `enable_admin_cors` as the likely causes.
- A viewer-role key works read-only: writes fail with APISIX's message; after the first
  such failure the UI shows a "read-only key" banner.
- Concurrent edit: before save the client re-GETs the object; if `modifiedIndex` changed
  since load, show a diff and ask (overwrite / reload). Best-effort, not atomic.
- Encrypted plugin fields are shown masked with a reveal toggle and sent back unchanged
  if not edited.
- **SSL is the one exception to "save = full PUT".** The private key can't be read back,
  so the SSL editor shows "private key: stored, not shown" with a **Replace certificate**
  action (paste/upload cert + key together). Saving without replacing sends a `PATCH`
  of the changed fields only (SNIs, labels, status, client CA…); replacing sends a full
  `PUT`.
- Resource types or endpoints missing on an older 3.x (e.g. credentials before 3.11)
  hide their nav entry instead of erroring.

### Testing

- Unit: schema-form generator against the real plugin schemas dumped from 3.20 (every
  plugin must render without throwing, and round-trip its example config unchanged);
  upstream/host resolution; table state.
- End-to-end (Playwright, `dev/compose.yaml` APISIX): for each resource type create →
  appears in list → edit → delete; routes sort/columns/filter/bulk; plugin form ⇄ JSON
  round trip; connect flow in static and proxy mode; a request through the gateway
  confirming a created route actually routes.

### Delivery

- `docker build` produces one small image (distroless, non-root). `compose.yaml` example.
- `web/dist` is the static export; a release zip of it; README covers both modes plus the
  `allow_admin` note.

## Left to the builder

Exact component styling, table library details, router choice, file layout inside
`web/src`, which plugin categories to show in the picker, summary-line wording per plugin.

## Build order

1. Dev APISIX compose, repo scaffold, API client, Connect screen, shell.
2. Shared table + Routes list (the main complaint), then the shared edit frame + Route editor.
3. Schema-form generator + Plugins tab.
4. Upstreams, Services, Consumers + Credentials, SSL.
5. The remaining resources (mostly schema-driven), global search, group-by-host.
6. Go server, Docker image, README, end-to-end pass.
