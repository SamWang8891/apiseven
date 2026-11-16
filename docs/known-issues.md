# Known issues

This page lists behaviour in apiseven's first release that is known to be wrong, incomplete or
surprising, and that was left for a later release. None of it stops normal use: lists, editors and
saves work, and APISIX still checks every write itself. Most items can be worked around in the JSON
tab, which every editor has and which always shows and edits the whole object (secrets stay
masked), or by reloading the page, which reads everything from APISIX again.

## Things you may notice

### Connecting

- At start the app asks for `config.json` next to the page, with no time limit. If the web server
  serving the static folder never answers that request, the app stays on its start screen until the
  browser gives up. A 404 answer is fine.

### Lists and search

- With the Usage filter on, the services, upstreams, plugin configs and SSL lists say that nothing
  matches while the lists they are checked against are still loading. Wait for loading to finish.
  If one of those lists failed to load, the services, plugin configs and SSL lists go on saying
  that nothing matches (the upstreams list offers Unknown instead): reload the page.

### Editing in general

- The dashboard's own checks can refuse a `$env://` or `$secret://` reference where APISIX accepts
  one (for example an SSL's `type`, an item of `ssl_protocols`, or a route's host). Enter the
  reference in the JSON tab and use Save anyway, which lets APISIX decide.
- After Duplicate, a copied multi-line secret (a secret manager's key, a plugin's key) reads "A new
  value was entered, not shown", and a copied upstream TLS client key reads "A new private key was
  entered, not shown". It is the copied value.
- In a key/value list (labels, headers and the like), a row you were editing when the object changed
  in APISIX is kept, with the advice "Edit it to keep it, or remove it". If that row has taken the
  place of an entry the newer version has, removing it deletes that entry too. Check the JSON tab
  before saving.

### Private keys

apiseven hides a PEM private key wherever APISIX expects one (an SSL's keys, an upstream's
`client_key` and the like), in every JSON view and every Copy, wherever the key sits in the value,
and in every field of a plugin form generated from its schema. Forms say "not shown" in words; JSON
views show dots in its place, and that is what Copy copies; search ignores key text. While you type
or paste a key it stays visible until you leave that box or JSON view, and after you leave a JSON
view that held one, Undo no longer goes back past that moment. Where it is not hidden, and the other
known gaps:

- Not hidden, by decision:
  - a private key used as a property name (a header name in a map, for example) is shown and copied
    like any other name; typed as a name in a JSON view, it is replaced when you leave the view, and
    that text cannot be saved until you take it out;
  - a key stored in a plugin's run options (its error response or its filter) is shown as that
    field's text, locked and editing;
  - a key pasted into a list of short values (a route's hosts, for example) is split at its spaces
    and line breaks, and the parts the list accepts become entries, shown like any other: none of
    them is recognised as a key;
  - the other fields of the editors show what they hold as text: a private key stored in a route's
    description is shown in that field and in the routes list, and the same goes for a name, a
    route's script or filter function, and an upstream's fields.

  Keep keys out of these places.
- Some fields keep what you typed as it is after you leave them, whether they take it or refuse it:
  a key/value list (labels, headers), an upstream's node addresses, a route's conditions builder, and
  a plugin's run options written as JSON. A private key typed or pasted there stays visible, and the
  message shown when you try to save can quote it (a key used twice, an address used twice, a
  condition value that is not a number). Remove it before you leave the field.
- A PGP private key (`-----BEGIN PGP PRIVATE KEY BLOCK-----`) is not recognised as one: it is shown
  and copied like any other text, unless its field is a secret one, which is masked until you press
  Show secrets.
- In the SSL editor, a certificate pasted into the middle of a private key leaves the end of the key
  (its last lines and its END line) visible after you leave the box. Empty the box and paste the
  certificate and the key separately.
- In a JSON view whose text has an unmatched quote somewhere before the key, a key whose dashes are
  written as `\u002d` escapes stays visible after you leave the view. Fix the quote, or use Discard.
- In a JSON view, text without a `-----BEGIN` line typed into a private-key field (an SSL's `key` or
  `keys`, or any `client_key`) is hidden when you leave the view, but Undo can bring it back.
- In a plugin form, a private key that is cut short (a BEGIN line but no END line) is taken as it
  is: the box closes, reads "A new value was entered, not shown", and Save sends the incomplete key.
  The SSL editor refuses such a key. Paste the whole key.
- Text that only quotes the first line of a private key (`-----BEGIN PRIVATE KEY-----`), in
  instructions for example, is treated as a key from that line to its end: it is not shown, and the
  JSON views mask it from that line on.
- In a JSON view, a private key pasted without quotes and without its END line takes the rest of the
  text with it when you leave the view: everything after it becomes part of its "•••••••• private
  key …, not shown" line. That text cannot be saved, and Undo does not bring the rest back. Use
  Discard and paste the key again, inside quotes; repairing the text around that line would save the
  rest as part of the key.

### Routes

- A label value with a non-breaking space, or near the 256-character limit with emoji, is refused
  although APISIX accepts it. Use Save anyway.
- `methods` written as a single string (`"GET"`), or an empty `hosts` or `remote_addrs` list, typed
  in the JSON tab, is not caught before saving; APISIX refuses it and its message is shown.
- Grouped by host, the routes list can say "No certificate is served for" an IP address. That holds
  only when APISIX has no `apisix.ssl.fallback_sni`, which the dashboard cannot read.

### Plugins

- When APISIX refuses a plugin's invalid `_meta.filter`, its message is the same as for a bad
  `vars` condition, so the dashboard points at the route's `vars`. If `vars` looks right, check the
  plugins' `_meta.filter`.
- In the Plugins column of the services, plugin configs, global rules, routes and stream routes
  lists, a plugin that is not built into APISIX but that APISIX runs for the whole instance shows as
  an ordinary plugin, or as off when it is marked off. Such an entry has no effect on that object;
  its card in the editor says so.

### Upstreams

- Where no TLS client private key is set yet, one cannot be typed by hand: after the first
  character the box closes and reads "A new private key was entered, not shown". Paste the whole key
  or upload the file, or press Replace key and type in the box it opens.
- In the map form of the node list (`{"host:port": weight}`), a node whose host you clear is not
  flagged as missing a host, and a second one cleared at the same port is flagged as having the same
  address as the first. Enter every host before saving.
- In the map form of the node list, a host made only of digits, with no port, is taken only when you
  press Enter (or paste several addresses), and its node then moves to the top of the list: the
  browser always puts such an address first. What you were typing in other rows stays with its node.
- If another client removes a stream upstream's keepalive pool while you have it open, the pool's
  group stays on screen with default values after the refresh.

### SSL certificates

- "Presented for N route hosts" counts HTTP route hosts only, not a stream route's `sni`.
- The SSL list sorts client certificates as enabled or disabled although APISIX ignores their
  status, and its mTLS column reads "Yes" for a client certificate with a `client` block, which
  APISIX never applies to one.
- Removing an additional certificate pair asks for no confirmation, although every other additional
  pair's private key must then be entered again.
- If you change the main certificate in the JSON tab without a new key, the key still reads "Stored
  in APISIX, not shown", although it belongs to the old certificate. Enter the new key too.
- If someone else changed the additional pairs while you edited, "Overwrite with mine" in the
  conflict dialog sends your certificates without keys. With a different count APISIX refuses; with
  the same count it stores them with the other person's keys, which do not match, and TLS fails
  for them. Choose "Reload theirs" and redo your change.
- A client certificate used only by an upstream inside a traffic-split plugin config counts as
  unused.
- When two certificates at the same wildcard level match a host and only one passes APISIX's check
  after matching, the dashboard names that one; APISIX checks only the one it loaded first, so it
  may serve that certificate or none.
- Deleting `certs` in the JSON tab of a stored certificate with additional pairs is refused with
  "enter the private key of each again", although there is nothing to enter. Remove the pairs with
  their Remove buttons instead, or also set `keys` to `[]` in the JSON tab.
- While a `$secret://` or `$env://` reference is being typed, the bare prefix is described as "no
  spaces, nothing after it" rather than as not complete yet.
- On a new certificate, a private key given as a `$secret://` or `$env://` reference is called a
  private key after a tab switch ("Private key entered, not shown"; after Replace key, "The private
  key entered before stays, not shown, …"), and it is not shown again; enter it again to be sure
  which reference is used. While a reference you just entered stands, the line "The reference
  entered before stays until a whole key is entered here" leaves out that emptying the box goes back
  to the key entered before it.

### Consumers and credentials

- The "Still signs in", "Still used" and "Always on" labels on auth entries are sometimes too
  definite:
  - an entry marked off (`_meta.disable`) that can sign nobody in still reads "Still signs in" or
    "Still used": basic-auth with an empty password, jwt-auth with `base64_secret: true` and a
    secret that does not decode, jwe-decrypt with a secret that is not 32 bytes;
  - an entry with a `$secret://` or `$env://` reference does not say that APISIX skips it when a
    reference does not resolve;
  - before the plugin list has loaded, or if it failed, a built-in auth plugin is taken to sign in,
    even one this APISIX has turned off in its configuration;
  - a `multi-auth` entry on a consumer or credential shows "Always on" and revoke advice, but APISIX
    never looks it up there (it uses the route's `multi-auth` config).
- "APISIX signs in a request that matches its …" leaves out that basic-auth, jwt-auth and hmac-auth
  also check the password or signature.
- An ldap-auth-advanced entry does not mention that a route with `consumer_required: false` signs
  LDAP users in without any consumer entry.
- For an auth plugin not built into APISIX, the consumer's card hides `_meta.disable`, the one
  option APISIX honours for its other phases, and its "Always on" / "Off ignored" badges do not say
  they concern sign-in only. Set `_meta.disable` in the JSON tab.
- After Duplicate, the notice calls APISIX's duplicate check best effort; for wolf-rbac's `appid`
  there is no check at all. Change the copied `appid` before Create.

### Other resources

- Protos: for a compiled descriptor, the list's size column counts the stored base64 text and the
  Content tab counts the decoded bytes.
- Protos: a `.proto` source file with a control character (for example in a comment) is refused as
  "Not proto source"; if it starts with a line feed, it is stored as a compiled descriptor instead.
  Remove the control character before uploading the file.
- Secrets: after Duplicate, the notice listing masked credentials stays after you switch the
  manager, although switching clears them.
- Secrets and plugin metadata: the manager or plugin selector stays enabled while a create is in
  progress. Changing a secret's manager then can create it with one manager's ID and another's
  settings. Wait for the save to finish.
- Stream routes: one that names a missing service and has its own upstream shows that upstream in
  the list, although APISIX ends such a connection. The editor does flag the missing service.

### Keyboard and screen readers

- A toast that comes back from waiting is shown first but comes last in Tab order.
- The header's Search button, a plugin card's head and a collapsible section's head show more text
  than their accessible name, which is only "Search", the plugin's name or the section's title (the
  shortcut, the plugin's summary and category, or the section's summary come as a description or a
  keyboard shortcut). With speech input, say just that name.

### The Docker server

- When APISIX does not answer the server's connection attempts at all, the error can take about
  30 seconds to appear: the server waits up to 10 seconds for each connection, and the app tries
  three times before it shows the error.

## Limits by design

- **A read-only (viewer) key is recognised only after APISIX refuses a write.** APISIX has no call
  that tells a client which role its key has, so New and Edit are offered until the first refused
  write. From then on the connection shows as read-only and no further write is sent, until the
  page is reloaded or you connect with another key.
- **Consumer credentials are not in the command palette's search.** The palette does not fetch
  them. Open the consumer to find its credentials.
- **The Admin API must answer in its v3 format** (`deployment.admin.admin_api_version: v3`,
  APISIX 3.20's default). apiseven cannot read the older v2 format; the Connect page says so and
  names the setting.
- **In Docker mode the Content-Security-Policy allows `'unsafe-eval'`.** The form validator compiles
  each JSON schema your APISIX reports into a function, in the browser; without it the plugin forms
  lose their checks and their conditional fields. Dropping it needs a validator that checks schemas
  without generating code.
- **The single file and the static folder have no Content-Security-Policy of their own.** No
  apiseven server sends them headers; the static folder gets whatever your web server adds.
- **Everything is loaded into the browser**, which suits up to a few thousand objects per type.
- **Some of APISIX's checks run only when you save.** The browser's checks of plugin configs cover
  what JSON Schema can express; APISIX's own check on save has the final word.
- **Only what the Admin API offers:** no metrics, logs or traffic data, no editing of APISIX's
  `config.yaml`, and no user accounts (access is whatever the admin key allows).
- **The Docker server's connection to an `https://` Admin API** always checks APISIX's certificate
  and host name; the check cannot be switched off. It presents no client certificate, so an Admin
  API that requires one is not supported.
- **The Docker server ignores `HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY`** and always connects to
  APISIX directly.
- **Without Basic auth, the Docker server answers only requests for IP addresses, `localhost` and
  the names in `ALLOWED_HOSTS`**, so that a domain resolving to it (DNS rebinding) gets nothing.
- **APISIX 2.x and the standalone (YAML) mode are not supported.** apiseven is developed and tested
  against APISIX 3.20 with the etcd-backed Admin API.

## For maintainers

Paths are relative to the repository root.

**API client, connection, shell**
- `web/src/api/client.ts` `AdminClient.list()` stops after the first page when a response has no
  `total` and the page is full; it should page until a page comes back short.
- `AdminClient.supports()` (`web/src/api/client.ts`) has a ternary whose two branches are equal, on
  the credentials path.
- `web/src/connection/store.ts` reads session-only keys from a plain object by id; an id such as
  `constructor` finds an inherited property. Use `Object.hasOwn`.
- `web/src/App.tsx` creates the router in a `useState` initialiser, so StrictMode builds two.
- The shell (`web/src/shell/Shell.tsx`) memoises `AdminClient` on the connection object's identity,
  so a storage event rebuilds it and drops its plugin cache; memoise on `id`, `baseUrl`, `key`.
- `web/index.html` has a hard-coded `<title>`, not one from `t()`.
- `web/src/shell/CommandPalette.tsx` fetches plugin metadata, protos and secrets even for kinds this
  APISIX does not support.
- An id containing a literal `%2F` reaches the page as `/`: React Router's `matchPath` turns `%2F`
  in a decoded parameter into `/` (read by `useParams()` in `web/src/router/routeElements.tsx`).
  APISIX's id pattern allows no `%`, so no stored object has such an id.
- The client does not read `X-API-VERSION`; it recognises the v2 format from the response's shape
  (`isV2Format`, `web/src/api/client.ts`), since a proxy can drop headers.

**Kit, schema form, plugin forms**
- A user-typed key `__proto__` (also check `constructor`, `prototype`) is lost or misused where an
  object is built from it: `web/src/ui/KeyValueInput.tsx`, `web/src/schema-form/fields/MapField.tsx`,
  `web/src/editor/draft.ts` `setPath` / `setPathRaw` / `removeAt`, `mergePatch` in
  `web/src/editor/save.ts`, `web/src/api/sanitize.ts`.
- `web/src/ui/codemirror/CodeEditorImpl.tsx` rebuilds the JSON language support, schema lint and
  completion included, whenever the `jsonSchema` prop's identity changes. The Ajv compile is cached
  per schema object (`web/src/schema/ajv.ts`), so a caller that passes a new but equal schema still
  recompiles; today's callers pass stable schemas.
- Lint messages in `web/src/ui/codemirror/jsonSchema.ts` (`describe`, from `errorMessage` in
  `web/src/schema/ajv.ts`) bypass `t()`.
- Ajv applies keywords beside a `$ref` (APISIX's Lua validator ignores them) and a schema-valued
  `propertyNames` (the Lua validator handles only `true` / `false`); neither occurs in the 3.20
  schemas.
- `fieldErrors` (`web/src/schema/ajv.ts`) runs `withDefaults` twice per call; the stream-route
  editor also fetches the http plugin set (`web/src/editor/Editor.tsx`).
- `web/src/plugins/PluginCard.tsx` `docsUrl` does not `encodeURIComponent` the plugin name.
- `web/src/ui/entryRows.ts` `entriesOf` emits integer-like keys (`"10"`, `"2"`) in JavaScript's
  object order, not row order; harmless to APISIX, but the kit says "row order".
- `web/src/ui/entryRows.ts`: when two held rows keep the same key, the earlier row's entry wins,
  which can bring back an older value; the most recently committed should win.
- `web/src/editor/Editor.tsx`: `env` depends on the typed id, so every keystroke in an ID field
  reruns the whole validation, Ajv plugin checks included.
- `web/src/ui/TagInput.tsx` decides "typed over the whole text" in `onKeyDown` (`key.length === 1`
  without Ctrl, Alt or Meta), so an IME composition or an AltGr character typed over what a paste
  left keeps that text's split, and Enter splits it at spaces. Decide in `onBeforeInput` instead
  (`insertText` / `insertCompositionText` with the whole value selected). The component's doc
  ("Text typed is one tag, spaces and all") also says more than it does: text typed inside a
  paste's leftover is split with it.
- `asLuaTables` (`web/src/schema/ajv.ts`) turns every empty-table place the errors ask for in one
  round, and only one a round at or below a failing `anyOf` / `oneOf`. A failing `contains` also
  reports every item's errors (Ajv resets them only when it passes), and the places under it are
  batched like any other; no case is known where that reads a value wrongly, and none is tested.

**Lists and tables**
- `expiryTone` and `daysLeft` (`web/src/resources/expiry.tsx`) each call `Date.now()` when no `now`
  is passed; pass one `now`.
- `useTableState` (`web/src/table/tableState.ts`) writes `localStorage` inside a state updater.
- `web/src/table/Toolbar.tsx`: the `data-view-control` marker covers the whole toolbar, including
  the `toolbarExtra` slot, so the locked-controls test helper would skip a write control added
  there.
- `web/src/resources/consumer_groups/columns.tsx` `membersOf` scans every consumer per group, from
  both the accessor and the cell; precompute once per `ctx`.
- The plain Plugins cells of the services, plugin configs and global rules lists (`servicePlugins`,
  `web/src/resources/services/columns.tsx`) and of the routes and stream routes lists
  (`effectivePlugins` / `streamEffectivePlugins`, `web/src/resources/resolve.ts`) get no plugin
  list, so `entryEffect` decides by the built-in names only: a custom plugin reported as
  `scope: "global"` reads as an ordinary chip, or "off".

**Editor frame**
- `web/src/editor/Editor.tsx` is 576 lines, past 400; the next seam is the save function's result
  handling. `RemovedNotice` copies `MissingEditor`'s notice markup (both in
  `web/src/editor/EditorFrame.tsx`).
- On a create-when-missing page the JSON tab's `id` is compared only with `newId`, not with the
  fixed id (`idIssues`, `web/src/editor/issues.ts`).
- `web/src/editor/headerStatus.ts` `useHeaderStatus` is named like a hook but is not one.
- `#/plugin_metadata/~new?from=<plugin>` still opens a copy although the kind has `noDuplicate`
  (`web/src/pages/EditorPage.tsx`).
- Duplicating an object whose id cannot be addressed reads "The Route to copy doesn't exist any
  more": the client fails that read as a 404 (`unaddressable`, `web/src/api/client.ts`).
- Secret ids: a leading space in the id part is kept while a trailing one is trimmed, because
  `newIdState` (`web/src/editor/newId.ts`) trims the whole `<manager>/<id>` text.
- `web/src/editor/useSaveRequest.ts`: the hook's doc comment sits above the `SaveFrom` interface's
  own, not above `useSaveRequest`.

**Upstream form**
- `web/src/upstream/fields.tsx` is 453 lines; `PemField`, `keyWhy` and `UploadButton` would fit a
  file of their own.

**Routes**
- `web/src/resources/routes/MatchingTab.tsx` and `web/src/resources/routes/VarsBuilder.tsx` use kit
  class names and a raw `<input className="ui-input">` instead of kit components.
- `web/src/resources/routes/VarsBuilder.tsx` `OPERATOR_OPTIONS` calls `t()` once at module load.
- The other patterns copied from `schema_def.lua` into the `…Issues` functions have not been checked
  for the JavaScript-versus-PCRE differences behind the label check (`\s`, `\w`, `\d`, `.`,
  anchors).
- `web/src/resources/routes/pairs.ts` `readPair` lets `sni` win while APISIX's router reads `snis`
  first; a client SSL may store both, and an SNIs edit then drops `snis`.

**SSL certificates**
- `time()` in `web/src/resources/ssls/parseCert.ts` mis-maps `GeneralizedTime` years 0000–0099 and
  lets impossible dates (Feb 31) roll over.
- `sslIssues` (`web/src/resources/ssls/validate.ts`) counts stored keys on the object as loaded,
  while a conflict Overwrite's PATCH merges into the server's current value.
- `web/src/resources/ssls/usage.ts` `sniNames` / `typeOf` repeat the rules of `sniList` /
  `servedToClients` in `web/src/resources/resolve.ts` without the normalising.
- A CA, or a new SSL's certificate (a duplicate's included), whose text is a reference followed by
  more text is held from the moment the tab mounts, so every save is refused while that tab is open:
  `CertBox` (`web/src/resources/ssls/PemBoxes.tsx`) starts with the value as its text, and
  `heldWhy` (`pemBox.ts`) refuses it.
- A CA holding a private key that exists only in the draft (typed in the JSON tab) shows on the
  Client mTLS tab as held and blocks Save from there, while the same draft saves from the JSON tab
  (`web/src/resources/ssls/ClientTab.tsx`).
- The key/certificate comparison reduces EC points to x and parity, so an off-curve point can read
  "matches" (`web/src/resources/ssls/publicKey.ts`; OpenSSL refuses such a certificate anyway).
- An IPv4 SNI with a trailing dot (`10.0.0.1.`) is matched as a DNS name
  (`web/src/resources/ssls/sniCover.ts`).
- `ipValue` (`web/src/resources/ssls/sniCover.ts`) accepts a dotted-quad tail outside the last group
  and reads `010.0.0.1` as decimal; it cannot make a real SAN cover a wrong SNI.
- The key box's words (`kept`, `web/src/resources/ssls/pemBox.ts`) choose `ssl.key.stays` ("the
  private key entered before") whenever the value is the key that stood, also when that is a
  reference; `ssl.key.refStays` does not say that emptying the box goes back to the key that stood.

**Private keys**
- Where the gaps listed under "Private keys" above sit: the fields that show text as typed
  (`web/src/resources/MetaFields.tsx` name and desc, `web/src/resources/routes/AdvancedTab.tsx`
  script, `web/src/resources/routes/MatchingTab.tsx` filter_func, `NameDescCell` in
  `web/src/resources/cells.tsx`, the upstream form's text fields) never call `holdsPrivateKey`, nor
  does `web/src/plugins/MetaForm.tsx` for `_meta.error_response` and `_meta.filter`;
  `hideNeverShown` and `veilValue` walk values, never property names; the shared detection
  (`holdsPrivateKey` / `withoutPrivateKeys`, exported from `web/src/schema/secrets.ts`) needs
  `PRIVATE KEY-----`, which a PGP block's first line lacks, and runs a block with no END line to
  the end of the text, so a half key in a form field is masked and saved as typed
  (`web/src/schema-form/fields/StringField.tsx`, `SecretText.tsx`) and quoted prose is masked from
  its BEGIN line on; `web/src/ui/TagInput.tsx` splits a paste at white space and commas before
  anything looks for a key; the SSL boxes' `keyBlocks`
  (`web/src/resources/ssls/pemBox.ts`) ends a block without its own END line at the next
  `-----BEGIN` line, which leaves the tail of a key after a pasted certificate.
- Text typed and kept as it is, refused or not, is never masked on leaving in
  `web/src/ui/KeyValueInput.tsx` (`ui.pending.duplicateKey` quotes a repeated key),
  `web/src/upstream/NodesTable.tsx` (`up.pending.duplicate` quotes the address as typed),
  `web/src/resources/routes/VarsBuilder.tsx` (`rt.vars.held.notNumber`, built in
  `web/src/resources/routes/vars.ts`, quotes the value; its JSON view keeps text that does not parse,
  under the parser's message) and `JsonValue` in `web/src/plugins/MetaForm.tsx`, unlike the PEM
  fields and the JSON views, which mask key material when they are left.
- `veilTypedText` (`web/src/schema/keyNotes.ts`), in its last pass over the raw text: a block
  between strings with no END line runs to the end of the text, so an unquoted half key takes the
  rest of a broken text into its note. End such a block before the next `"` (a PEM never holds one).
- The same pass tests the raw text only: a BEGIN line whose dashes are `\u` escapes, in a string
  the lenient reader (`literalsOf`) misread after an unbalanced quote, is not veiled. Match a BEGIN
  line whose characters may be written as `\u00XX` there.
- `veilTypedText` rewrites a string that held a key as `JSON.stringify` of its lenient decoding, so
  other text in that string changes too: an invalid escape (`"C:\xyz <key>"`) becomes an escaped
  backslash.
- The JSON views (`web/src/editor/JsonTab.tsx`, `web/src/plugins/ConfigJson.tsx`,
  `web/src/schema-form/fields/JsonField.tsx`) empty their undo history on leaving only when a
  private-key BEGIN line was in the text (`holdsKeyMaterial`), so text without one typed into a
  whole-key place, veiled whole on leaving, can come back by undo.
- `refusalOf` accepts a note at any path that differs from its own only in array indices
  (`sameButIndices`), for every array alike: in a list used as a tuple (a route's `vars`,
  `[[name, op, value]]`), a note made at `vars.0.2` may stand at `vars.0.0`. A key still cannot
  reach a field of another name.
- `veilValue` reuses a note only at the path it was made at, so after a reorder of list elements
  holding keys the JSON tab's Format turns on once and mints new notes for the moved keys; nothing
  sent changes.
- `web/src/schema/keyNotes.ts` is 428 lines; the leave veil (`literalsOf`, `decode`,
  `veilTypedText`) could move to a module of its own (for example `web/src/schema/typedKeys.ts`).

**Duplicated code**
- `idOf` (`web/src/resources/resolve.ts` and nine other files), `groupOf`
  (`web/src/resources/consumers/filters.ts`, the same rule for group ids), `time` (in
  `web/src/resources/timeColumns.tsx` and eight columns files), `Mono`
  (`web/src/resources/Overview.tsx`, `web/src/resources/routes/GeneralTab.tsx`), `text` (the three
  stream-route tab files,
  `web/src/resources/MetaFields.tsx`, `web/src/resources/routes/GeneralTab.tsx`), the labels rule
  repeated in `web/src/upstream/validate.ts` instead of `labelsRefused`, `servicePlugins as
  ownPlugins` imported across folders, `encryptOf` in `web/src/plugins/secrets.ts` and
  `web/src/plugins/PluginCard.tsx`, and the Show/Hide secrets button in four places
  (`web/src/editor/JsonTab.tsx`, `web/src/plugins/ConfigJson.tsx`, `web/src/pages/RowActions.tsx`,
  `web/src/editor/ConflictDialog.tsx`).
- `web/src/resources/plugin_configs/UsedByTab.tsx` copies the embedded users table of
  `web/src/resources/services/RoutesTab.tsx`.
- Three "is the user typing" tests (`web/src/shell/usePaletteHotkey.ts`, `web/src/table/Toolbar.tsx`,
  `web/src/editor/useEditorKeys.ts`) and two lists of Ctx kinds (`CTX_LIST` in
  `web/src/shell/CommandPalette.tsx`, `CTX_LISTS` in `web/src/resources/resolve.ts`).

**Text**
- JSON type names reach user-visible messages raw (`'object'`, `types.join(' | ')` in
  `web/src/editor/JsonTab.tsx`, `web/src/plugins/ConfigJson.tsx`,
  `web/src/schema-form/fields/JsonField.tsx`); they should go through `t()` ("a JSON object", "a
  list").
- Host names quoted inside sentences (the SNI note, the duplicate-SNI note) are in the body font, not
  monospace; this needs rich interpolation in i18n.
- Unused i18n keys in `web/src/i18n/en.ts` (for example `editor.saving`), and no test that every key
  is used.
- Word order fixed in code instead of `web/src/i18n/en.ts`: `web/src/editor/EditorHeader.tsx` (the
  owner's kind before its link), `web/src/resources/cells.tsx` (`${name}: ${reason}`).

**Accessibility**
- The header's Search button (`web/src/shell/Header.tsx`), a plugin card's head
  (`web/src/plugins/PluginCard.tsx`) and a `Section` head (`web/src/resources/Section.tsx`) hold
  their shortcut hint, summary and category inside the button, so the visible text is longer than
  the accessible name (axe `label-content-name-mismatch`); `web/e2e/a11y.spec.ts` excludes that rule
  for these three controls (`NAMED_BY_TITLE`). Move those parts into siblings referenced by
  `aria-describedby`, keeping every accessible name, then drop the exclusion.

**Docker server**
- An upstream `1xx` response makes `httputil.ReverseProxy` (`server/proxy.go`) drop the security
  headers `server/handler.go` set; the Admin API sends none.
- Answers that `net/http` writes before the handler runs (400, 431) carry no `X-Apiseven-Refusal`
  marker.
- `server/proxy.go` `bodyErrorReason`: a body cut off inside its trailer is logged as `malformed`,
  not `truncated` (a log category only).

**Tests**
- `web/src/ui/Menu.tsx` has no focused behaviour test of its own (keyboard activation, focus
  return, dismissal); other tests only use it.
- No table-driven test that feeds mismatched value types into every schema-form node kind.
- No live test that a PATCH with a nested `null` deletes that key, which the SSL save path relies
  on.
- `web/src/test/reactProps.ts` reads React DOM's internal `__reactProps$*` key.
- `web/src/resources/stream_routes/inherit.test.tsx` has no "no service" row in its inheritance
  table.
- `web/src/editor/save.test.ts` swaps `AdminClient`'s private `fetchImpl` for one case; the `saved()`
  helper's doc comment is wrong.
- `web/src/resources/consumers/editor.test.tsx`: an orphaned doc comment.
- SSL: no test for "held edit of a stored CA, Discard and switch, the stored value is sent
  unchanged".
- PEM box property tests: `web/src/resources/ssls/pemBoxes.page.property.test.tsx` asserts the
  counts of the certificate box's actions only, so not that `keep` and `remove` ran, and judges
  holds only at saves; in `pemBoxes.property.test.tsx` the dialog's `save` does not press the primary
  button when the model says not ready.
- No example test presses Keep the entered key while the key box holds text: the rule-9 test in
  `web/src/resources/ssls/tabs.test.tsx` presses it over an empty box, and only the property test's
  `keep` action covers the other case.
- No test for a hidden required-value problem inside a closed `Section` opening on a refused Create;
  it works by reading.
- `web/src/brand.test.ts` does not assert that `theme_color`, `background_color` and `display` keep
  the supplied values.
- `web/src/test/fakeAdmin.ts` accepts POST and PATCH where APISIX answers 405, and takes any secret
  id shape.
- `web/src/resources/remaining.live.test.ts`: two probes that expect a refusal (a second global rule
  holding the same plugin, a vault secret without a token) register no undo.
- Command palette: no tests for the leave question while the editor holds unfinished input, a
  private-key block in `client.ca`, a stream route's inline `tls.client_key`, or "/" pressed inside
  the code editor.
- `web/src/resources/emptyTables.live.test.ts`, `web/src/upstream/checks.live.test.ts` and
  `web/src/plugins/neverShown.live.test.ts` write their objects under one id taken from the load time
  in milliseconds (`apiseven-live-${Date.now().toString(36)}`), so two of them loaded in the same
  millisecond by parallel workers write and delete each other's objects (seen once: two clean-ups
  answered 404). Give each file an id of its own.
- `web/src/ui/Button.test.tsx`: "a press on an inert button still closes an open popover" is tested
  only as "the press reaches a listener on the document", not with an open popover closing.
- `server/proxy_test.go` depends on `apisix.invalid` not resolving, and nothing exercises the
  `http.Server.ErrorLog` wired to slog in `server/main.go`.

**Dev tooling**
- `dev/*.mjs` are not linted: `web/eslint.config.js` covers `web/` only.
