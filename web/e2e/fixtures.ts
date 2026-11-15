// Shared fixtures and flows of the end-to-end suite. Specs import `test`, `expect` and the helpers
// from here; labels come from the app's own strings through `t()`, so a spec reads like the UI.
import { isDeepStrictEqual } from 'node:util';
import { test as base, expect, type BrowserContext, type Locator, type Page, type Request } from '@playwright/test';
import { t } from '../src/i18n';
import { Admin, eventually, gateway, type Json } from './admin';
import { ECHO, env } from './env';

export { expect, t };
export { Admin, eventually, gateway, servedCertificate, withoutTimes, type Json } from './admin';
export { ECHO, env } from './env';

/** A short random suffix: names in one run never collide with another run's leftovers. */
export function uid(): string {
  return Math.random().toString(36).slice(2, 8);
}

export type ConnectAs = 'admin' | 'viewer' | 'none';

interface Options {
  /** The saved connection the browser starts with. `none`: the Connect page. */
  connectAs: ConnectAs;
  /**
   * Console errors and failed requests this test expects (a negative test), as one pattern (an array
   * would read as Playwright's [value, options] pair in test.use). Matched against
   * `<status> <METHOD> <url>` for a failed request, `failed <METHOD> <url> <reason>` for one that got
   * no answer, and the message text for anything else.
   */
  allowConsole: RegExp | undefined;
}

interface Fixtures {
  admin: Admin;
}

export interface SavedConnection {
  id: string;
  name: string;
  key: string;
  baseUrl?: string;
}

/**
 * Puts saved connections into localStorage before the app first loads in a context (once per tab:
 * a reload keeps what the app changed since), the one named `active` active.
 */
export async function saveConnections(context: BrowserContext, list: SavedConnection[], active = list[0]?.id): Promise<void> {
  await context.addInitScript(
    ([connections, activeId]) => {
      if (sessionStorage.getItem('e2e.connection')) return;
      sessionStorage.setItem('e2e.connection', '1');
      localStorage.setItem('apiseven.connections', JSON.stringify(connections));
      if (activeId) localStorage.setItem('apiseven.activeConnection', activeId);
    },
    [list.map((c) => ({ ...c, baseUrl: c.baseUrl ?? env.adminUrl })), active] as const,
  );
}

interface Failed {
  url: string;
  status: number | undefined;
  method: string;
  text: string;
}

/** Collects what the page logs as errors, so a test fails on any it did not expect. */
function watchConsole(page: Page) {
  const failed: Failed[] = [];
  const messages: { text: string; url: string }[] = [];
  page.on('response', (res) => {
    if (res.status() >= 400) {
      const method = res.request().method();
      failed.push({ url: res.url(), status: res.status(), method, text: `${res.status()} ${method} ${res.url()}` });
    }
  });
  page.on('requestfailed', (req: Request) => {
    failed.push({ url: req.url(), status: undefined, method: req.method(), text: `failed ${req.method()} ${req.url()} ${req.failure()?.errorText ?? ''}` });
  });
  page.on('pageerror', (err) => messages.push({ text: `pageerror: ${err.message}`, url: '' }));
  page.on('console', (msg) => {
    if (msg.type() === 'error') messages.push({ text: msg.text(), url: msg.location().url });
  });
  return { failed, messages };
}

/**
 * What each logged line means: a "Failed to load resource" line is matched to the request behind it
 * (the first one on that URL not matched yet, so a later failure on the same URL is described as
 * itself), anything else is its own text.
 */
function describeProblems(seen: ReturnType<typeof watchConsole>): { text: string; failed?: Failed }[] {
  const used = new Set<Failed>();
  return seen.messages.map((m) => {
    if (!m.text.startsWith('Failed to load resource')) return { text: m.text };
    const status = /status of (\d+)/.exec(m.text)?.[1];
    const request = seen.failed.find((f) => !used.has(f) && f.url === m.url && (status === undefined || String(f.status) === status));
    if (!request) return { text: `${m.text} (${m.url})` };
    used.add(request);
    return { text: request.text, failed: request };
  });
}

/**
 * The one failed load every page may log: the app's probe for server mode (`config.json`), which a
 * static build does not have (Task 17, concern 4). Nothing else is allowed globally: a 404 that a test
 * expects (a create checks its id first; a kind created when missing) is declared by that test.
 */
const ALWAYS_ALLOWED = [/^404 GET [^ ]*\/config\.json$/];

/** Object reads each page is expected to see answered 404, as paths below /apisix/admin. */
const expectedNotFound = new WeakMap<Page, Set<string>>();

/**
 * Declares that this test expects APISIX to answer 404 to a read of one object (`routes/e2e-x`): the
 * create check before a create, a kind created when missing, an object deleted while shown.
 */
export function expectNotFound(page: Page, path: string): void {
  const set = expectedNotFound.get(page) ?? new Set<string>();
  set.add(path);
  expectedNotFound.set(page, set);
}

/** A consumer with no credentials: APISIX answers 404 to the list of them, which its pages read. */
export function expectNoCredentials(page: Page, username: string): void {
  expectNotFound(page, `consumers/${username}/credentials`);
}

function adminPathOf(url: string): string | undefined {
  const match = /\/apisix\/admin\/([^?]*)/.exec(url);
  return match ? decodeURIComponent(match[1]!) : undefined;
}

export const test = base.extend<Options & Fixtures>({
  connectAs: ['admin', { option: true }],
  allowConsole: [undefined, { option: true }],
  context: async ({ context, connectAs }, use) => {
    if (connectAs !== 'none') await saveConnections(context, [{ id: 'e2e', name: 'e2e', key: connectAs === 'admin' ? env.adminKey : env.viewerKey }]);
    await use(context);
  },
  page: async ({ page, allowConsole }, use) => {
    const seen = watchConsole(page);
    await use(page);
    const allowed = allowConsole ? [...ALWAYS_ALLOWED, allowConsole] : ALWAYS_ALLOWED;
    const notFound = expectedNotFound.get(page) ?? new Set<string>();
    const expected = (p: { text: string; failed?: Failed }) =>
      allowed.some((a) => a.test(p.text)) ||
      (p.failed?.status === 404 && p.failed.method === 'GET' && notFound.has(adminPathOf(p.failed.url) ?? ''));
    const unexpected = describeProblems(seen)
      .filter((p) => !expected(p))
      .map((p) => p.text);
    expect(unexpected, 'no console errors or unhandled rejections').toEqual([]);
  },
  admin: async ({}, use) => {
    await use(new Admin());
  },
});

// ---- Navigation -------------------------------------------------------------------------------

/** Opens `#/<path>` and waits for the shell's main region. */
export async function goto(page: Page, path: string): Promise<Locator> {
  await page.goto(`/#/${path.replace(/^#?\/?/, '')}`);
  const main = page.getByRole('main');
  await expect(main).toBeVisible();
  return main;
}

/**
 * Waits until nothing in <main> is still loading: the editor's skeleton and a lazily loaded tab body
 * are each a status with aria-busy while they load.
 */
export async function settled(page: Page): Promise<void> {
  await expect(page.getByRole('main').locator('[role="status"][aria-busy="true"]')).toHaveCount(0);
}

/** A list's loading status (its rows are on their way). */
function listLoading(main: Locator, kind: string): Locator {
  return main.getByRole('status', { name: t('table.loading', { plural: t(`kind.${kind}.plural`) }), exact: true });
}

/** Opens a stored object's editor (`routes/api-v1`, optionally `?tab=…`) and waits until it is shown, locked. */
export async function openEditor(page: Page, path: string): Promise<Locator> {
  const main = await goto(page, path);
  await expect(main.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(main.getByRole('button', { name: t('editor.edit'), exact: true })).toBeVisible();
  await settled(page);
  return main;
}

/** Opens a list page and waits for its rows. */
export async function openList(page: Page, kind: string): Promise<Locator> {
  const main = await goto(page, kind);
  await expect(main.getByRole('table').first()).toBeVisible();
  await expect(listLoading(main, kind)).toHaveCount(0);
  return main;
}

/** Edit → the page is unlocked. */
export async function unlock(page: Page): Promise<void> {
  await page.getByRole('main').getByRole('button', { name: t('editor.edit'), exact: true }).click();
  await expect(page.getByRole('main').getByRole('button', { name: t('editor.save'), exact: true })).toBeVisible();
  await settled(page);
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A tab by its label; a tab's name may go on with its problem badge ("Upstream 1 to fix"). */
export function tabNamed(page: Page, label: string): Locator {
  return page.getByRole('main').getByRole('tab', { name: new RegExp(`^${escape(label)}( |$)`) });
}

/** Selects an editor tab by its label and waits for its body. */
export async function openTab(page: Page, label: string): Promise<Locator> {
  const tab = tabNamed(page, label);
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await settled(page);
  return page.getByRole('main').getByRole('tabpanel', { name: new RegExp(`^${escape(label)}( |$)`) });
}

/** The upstream the suite proxies to, inline (see ECHO). */
export function echoUpstream(): Json {
  return { type: 'roundrobin', nodes: [{ host: ECHO.host, port: ECHO.port, weight: 1 }] };
}

/** A route to ECHO for one host name. */
export function echoRoute(name: string, host: string, extra: Json = {}): Json {
  return { name, host, uri: ECHO.path, upstream: echoUpstream(), ...extra };
}

/** A throwaway route to ECHO stored through the Admin API: its id (`<prefix><random>`), host and stored value. */
export async function storedRoute(admin: Admin, prefix: string, extra: Json = {}): Promise<{ id: string; host: string; stored: Json }> {
  const id = `${prefix}${uid()}`;
  const host = `${id}.e2e.test`;
  await admin.put(`routes/${id}`, echoRoute(id, host, extra));
  return { id, host, stored: await admin.must(`routes/${id}`) };
}

/** Waits until the gateway answers a request for `host` with `status` (APISIX applies changes within moments). */
export async function gatewayAnswers(host: string, status: number, opts: { path?: string; headers?: Record<string, string> } = {}) {
  const reply = await eventually(
    () => gateway(opts.path ?? ECHO.path, { host, headers: opts.headers }),
    (r) => r.status === status,
  );
  expect(reply.status, `the gateway's answer for ${host}${opts.path ?? ECHO.path}`).toBe(status);
  return reply;
}

// ---- Requests the app sends -------------------------------------------------------------------

export interface SentWrite {
  method: string;
  /** The path below /apisix/admin, decoded. */
  path: string;
  body: Json | undefined;
}

const ADMIN_PATH = /\/apisix\/admin\/(.*?)(\?.*)?$/;

function asWrite(req: Request): SentWrite | undefined {
  const match = ADMIN_PATH.exec(req.url());
  if (!match || req.method() === 'GET' || req.method() === 'OPTIONS') return undefined;
  const text = req.postData();
  let body: Json | undefined;
  try {
    body = text ? (JSON.parse(text) as Json) : undefined;
  } catch {
    body = undefined;
  }
  return { method: req.method(), path: decodeURIComponent(match[1]!), body };
}

/** Records every write the page sends to the Admin API from now on (the array fills as they go). */
export function recordWrites(page: Page): SentWrite[] {
  const writes: SentWrite[] = [];
  page.on('request', (req) => {
    const write = asWrite(req);
    if (write) writes.push(write);
  });
  return writes;
}

/** Waits for the next Admin API write the page sends, and its answer. */
export async function nextWrite(page: Page, action: () => Promise<void>): Promise<SentWrite & { status: number }> {
  const response = page.waitForResponse((res) => asWrite(res.request()) !== undefined);
  await action();
  const res = await response;
  return { ...asWrite(res.request())!, status: res.status() };
}

/** Save (the button), the write it sends, and the editor locked again afterwards. */
export async function save(page: Page): Promise<SentWrite & { status: number }> {
  const main = page.getByRole('main');
  const write = await nextWrite(page, () => main.getByRole('button', { name: t('editor.save'), exact: true }).click());
  expect(write.status, `${write.method} ${write.path} answered`).toBeLessThan(300);
  await expect(main.getByRole('button', { name: t('editor.edit'), exact: true })).toBeVisible();
  return write;
}

/** Create on a new object's page: the write it sends, and the stored editor it then shows. */
export async function create(page: Page): Promise<SentWrite & { status: number }> {
  const main = page.getByRole('main');
  const write = await nextWrite(page, () => main.getByRole('button', { name: t('editor.create'), exact: true }).click());
  expect(write.status, `${write.method} ${write.path} answered`).toBeLessThan(300);
  // A create with an id first reads that id, and APISIX answers 404: expected here.
  if (write.method === 'PUT') expectNotFound(page, write.path);
  await expect(main.getByRole('button', { name: t('editor.edit'), exact: true })).toBeVisible();
  return write;
}

// ---- What the page shows ---------------------------------------------------------------------

/**
 * Every control in `<main>` that takes input: inputs, textareas, selects, editable text and the
 * kit's controls by role. Skipped by their own markers: a table's view controls (search, column
 * menu, pager), the locked code editor's read-only content, hidden inputs and Radix's hidden native
 * input. A locked editor must have none.
 */
export async function operableControls(page: Page): Promise<string[]> {
  return page.getByRole('main').evaluate((main) => {
    const controls = [
      'input',
      'textarea',
      'select',
      '[contenteditable="true"]',
      ...['checkbox', 'radio', 'combobox', 'switch', 'spinbutton', 'textbox', 'slider', 'listbox'].map((r) => `[role="${r}"]`),
    ].join(', ');
    // A read-only textbox is the locked code editor's content; the other two are inputs nobody sees.
    const skip = ['[role="textbox"][aria-readonly="true"]', 'input[type="hidden"]', 'input[aria-hidden="true"][tabindex="-1"]'].join(', ');
    return [...main.querySelectorAll(controls)]
      .filter((el) => !el.matches(skip) && el.closest('[data-view-control]') === null)
      .map((el) => `${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''} ${el.getAttribute('aria-label') ?? (el as HTMLInputElement).name ?? ''}`.trim());
  });
}

/**
 * The toast that says `text` (a toast's text may carry more after it). While a modal dialog is open
 * the page behind it, toasts included, is hidden from the accessibility tree (Radix announces toasts
 * through a live region of its own), so hidden elements are included here.
 */
export function toast(page: Page, text: string | RegExp): Locator {
  return page
    .getByRole('region', { name: new RegExp(`^${escape(t('ui.toast.region', { hotkey: '\u0000' }).split('\u0000')[0]!)}`), includeHidden: true })
    .getByRole('listitem', { includeHidden: true })
    .filter({ hasText: text });
}

/**
 * Everything the page holds that a secret could hide in: its markup, the live value of every form
 * control (the markup does not carry what was typed), and the text of its accessibility tree.
 */
export async function pageHolds(page: Page): Promise<string> {
  const values = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')].map((el) => el.value).join('\n'),
  );
  return [await page.content(), values, await page.locator('body').ariaSnapshot()].join('\n');
}

/**
 * Fails if the page holds any of these secrets. The message names the secret by its position only,
 * so a failure never prints a secret into a log or a report.
 */
export async function expectNotInPage(page: Page, secrets: string[], where: string): Promise<void> {
  const holds = await pageHolds(page);
  secrets.forEach((secret, i) => expect(holds.includes(secret), `${where}: secret #${i + 1} is in the page`).toBe(false));
}

/**
 * A deep equality whose failure prints no value: for stored objects that hold a key, a password or a
 * token, so a failure never puts one into a log or a report.
 */
export function expectSameQuietly(actual: unknown, expected: unknown, what: string): void {
  expect(isDeepStrictEqual(actual, expected), `${what} (values not printed: they hold a secret)`).toBe(true);
}

/** The editor's banner (an alert) with this title: APISIX's refusal, "Not created", … */
export function banner(page: Page, title: string): Locator {
  return page.getByRole('main').getByRole('alert').filter({ hasText: title });
}

/**
 * Replaces the text of a code editor (its textbox, by role and name). Typed through insertText, so
 * brackets are not auto-closed.
 */
export async function setCode(page: Page, editor: Locator, text: string): Promise<void> {
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText(text);
}

/** The JSON tab's code editor. */
export function jsonEditor(page: Page, kindLabel: string): Locator {
  return page.getByRole('main').getByRole('textbox', { name: t('editor.json.label', { kind: kindLabel }) });
}

/** The text a code editor (its textbox) shows, line breaks included. */
export async function codeText(editor: Locator): Promise<string> {
  return editor.evaluate((el) => (el as HTMLElement).innerText.replace(/\n$/, ''));
}

// ---- Plugins ------------------------------------------------------------------------------------

/** A plugin's card on the Plugins tab. */
export function pluginCard(page: Page, name: string): Locator {
  return page.getByRole('main').getByRole('group', { name, exact: true });
}

/** Add plugin → search → Enter: the plugin is added with its card open. */
export async function addPlugin(page: Page, name: string): Promise<Locator> {
  await page.getByRole('main').getByRole('button', { name: t('pl.add'), exact: true }).click();
  const picker = page.getByRole('dialog', { name: t('pl.picker.title') });
  await picker.getByRole('combobox', { name: t('pl.picker.search') }).fill(name);
  await expect(picker.getByRole('option', { name, exact: true })).toBeVisible();
  await picker.getByRole('option', { name, exact: true }).click();
  await expect(picker).toBeHidden();
  const card = pluginCard(page, name);
  await expect(card.getByRole('button', { name: new RegExp(`^${escape(name)}\\b`) }).first()).toHaveAttribute('aria-expanded', 'true');
  return card;
}

/** Opens a plugin card (its header button) unless it is open already. */
export async function openCard(page: Page, name: string): Promise<Locator> {
  const card = pluginCard(page, name);
  const head = card.getByRole('button', { name: new RegExp(`^${escape(name)}\\b`) }).first();
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
  await expect(head).toHaveAttribute('aria-expanded', 'true');
  return card;
}

// ---- One field per tab ----------------------------------------------------------------------------

export interface TabChange {
  /** The tab's label. */
  tab: string;
  /** The top-level field the change is to land in. */
  field: string;
  /** The field's stored value afterwards (an asymmetric matcher works too). */
  value: (before: Json) => unknown;
  /** Makes the change inside the unlocked tab panel. */
  change: (panel: Locator, page: Page) => Promise<void>;
  /** The object holds a secret: compare without printing it. */
  secret?: true;
}

/**
 * Opens the editor locked on the tab (no controls), unlocks, makes the change, saves, and checks that
 * the Admin API now holds exactly the stored object with that one field changed: every other field,
 * unknown keys included, deep-equal to before.
 */
export async function changeOnTab(page: Page, admin: Admin, editor: string, api: string, change: TabChange): Promise<void> {
  const before = await admin.must(api);
  await openEditor(page, editor);
  await openTab(page, change.tab);
  expect(await operableControls(page), 'locked: no controls').toEqual([]);
  await unlock(page);
  await change.change(page.getByRole('main').getByRole('tabpanel'), page);
  await save(page);
  const expected = { ...before, [change.field]: change.value(before) };
  if (change.secret) expectSameQuietly(await admin.value(api), expected, `${api} after a change on ${change.tab}`);
  else expect(await admin.value(api)).toEqual(expected);
}

/** Picks an option of a kit Select or an object picker by its exact name. */
export async function choose(page: Page, combobox: Locator, option: string): Promise<void> {
  await combobox.click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

// ---- Create, list, delete ------------------------------------------------------------------------

/** A new object's ID field ("ID", or "ID (required)" for kinds that need one). */
export function idField(page: Page): Locator {
  return page.getByRole('main').getByRole('textbox', { name: new RegExp(`^${escape(t('editor.id.label'))}( \\(${escape(t('ui.required'))}\\))?$`) });
}

/** Opens a new object's page (going through another page first, so no earlier draft is reused). */
export async function openNew(page: Page, path: string): Promise<Locator> {
  await page.goto('/#/routes');
  await expect(page.getByRole('main')).toBeVisible();
  const main = await goto(page, path);
  await expect(main.getByRole('button', { name: t('editor.create'), exact: true })).toBeVisible();
  await settled(page);
  return main;
}

/** The editor's ⋯ menu → Delete → confirmed; waits for the page to leave the editor. */
export async function deleteFromEditor(page: Page, kindSingular: string): Promise<void> {
  const main = page.getByRole('main');
  await main.getByRole('button', { name: t('editor.more') }).click();
  await page.getByRole('menuitem', { name: t('action.delete') }).click();
  const confirm = page.getByRole('alertdialog');
  const write = nextWrite(page, () => confirm.getByRole('button', { name: t('delete.confirm', { kind: kindSingular }) }).click());
  expect((await write).method).toBe('DELETE');
  await expect(confirm).toBeHidden();
}

/** A list page shows (or no longer shows) the row linking to `name`. */
export async function listShows(page: Page, kindPath: string, name: string, shown = true): Promise<void> {
  const main = await goto(page, kindPath);
  await expect(main.getByRole('heading', { level: 1, name: t(`kind.${kindPath}.plural`) })).toBeVisible();
  await expect(listLoading(main, kindPath)).toHaveCount(0);
  const link = main.getByRole('link', { name, exact: true });
  if (shown) await expect(link).toBeVisible();
  else await expect(link).toHaveCount(0);
}
