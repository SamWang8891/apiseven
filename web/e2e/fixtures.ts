// Shared fixtures and flows of the end-to-end suite. Specs import `test`, `expect` and the helpers
// from here; labels come from the app's own strings through `t()`, so a spec reads like the UI.
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
   * Console errors and failed requests this test expects (a negative test). Matched against
   * `<status> <METHOD> <url>` for a failed request, `failed <METHOD> <url> <reason>` for one that got
   * no answer, and the message text for anything else.
   */
  allowConsole: (string | RegExp)[];
}

interface Fixtures {
  admin: Admin;
}

/** Puts one saved, active connection into localStorage before the app first loads in a context. */
export async function saveConnection(context: BrowserContext, key: string, name = 'e2e'): Promise<void> {
  await context.addInitScript(
    ([baseUrl, k, n]) => {
      if (sessionStorage.getItem('e2e.connection')) return;
      sessionStorage.setItem('e2e.connection', '1');
      localStorage.setItem('apiseven.connections', JSON.stringify([{ id: 'e2e', name: n, baseUrl, key: k }]));
      localStorage.setItem('apiseven.activeConnection', 'e2e');
    },
    [env.adminUrl, key, name],
  );
}

/** Collects what the page logs as errors, so a test fails on any it did not expect. */
function watchConsole(page: Page) {
  const failed: { url: string; text: string }[] = [];
  const messages: { text: string; url: string }[] = [];
  page.on('response', (res) => {
    if (res.status() >= 400) failed.push({ url: res.url(), text: `${res.status()} ${res.request().method()} ${res.url()}` });
  });
  page.on('requestfailed', (req: Request) => {
    failed.push({ url: req.url(), text: `failed ${req.method()} ${req.url()} ${req.failure()?.errorText ?? ''}` });
  });
  page.on('pageerror', (err) => messages.push({ text: `pageerror: ${err.message}`, url: '' }));
  page.on('console', (msg) => {
    if (msg.type() === 'error') messages.push({ text: msg.text(), url: msg.location().url });
  });
  return { failed, messages };
}

/** What a failed load means: the request behind a "Failed to load resource" line, else the line. */
function describeProblems(seen: ReturnType<typeof watchConsole>): string[] {
  return seen.messages.map((m) => {
    if (m.text.startsWith('Failed to load resource')) {
      const request = seen.failed.find((f) => f.url === m.url);
      return request ? request.text : `${m.text} (${m.url})`;
    }
    return m.text;
  });
}

/**
 * Failed loads every page may log: the app's probe for server mode (`config.json`, absent from a
 * static build), and a GET that answers 404, which is how APISIX says "not stored" to the checks the
 * app makes on purpose (a create checks its id first; an editor of a kind that is created when
 * missing; support probes).
 */
const ALWAYS_ALLOWED = [/^404 GET .*\/config\.json$/, /^404 GET .*\/apisix\/admin\//];

export const test = base.extend<Options & Fixtures>({
  connectAs: ['admin', { option: true }],
  allowConsole: [[], { option: true }],
  context: async ({ context, connectAs }, use) => {
    if (connectAs !== 'none') await saveConnection(context, connectAs === 'admin' ? env.adminKey : env.viewerKey);
    await use(context);
  },
  page: async ({ page, allowConsole }, use) => {
    const seen = watchConsole(page);
    await use(page);
    const allowed = [...ALWAYS_ALLOWED, ...allowConsole];
    const unexpected = describeProblems(seen).filter((text) => !allowed.some((a) => (typeof a === 'string' ? text.includes(a) : a.test(text))));
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

/** Waits until the editor's lazy tab body (and any skeleton) has rendered. */
export async function settled(page: Page): Promise<void> {
  await expect(page.locator('.ed-lazy__loading, .ed-skel, [aria-busy="true"].ed')).toHaveCount(0);
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
  await expect(main.locator('.tbl-state')).toHaveCount(0);
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
    const skip = ['.cm-content[aria-readonly="true"]', 'input[type="hidden"]', 'input[aria-hidden="true"][tabindex="-1"]'].join(', ');
    return [...main.querySelectorAll(controls)]
      .filter((el) => !el.matches(skip) && el.closest('[data-view-control]') === null)
      .map((el) => `${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''} ${el.getAttribute('aria-label') ?? (el as HTMLInputElement).name ?? ''}`.trim());
  });
}

/** The toast that says `text` (a toast's text may carry more after it). */
export function toast(page: Page, text: string | RegExp): Locator {
  return page.getByRole('region', { name: /^Notifications/ }).getByRole('listitem').filter({ hasText: text });
}

/** The editor's banner (APISIX's refusal, "Not created", …). */
export function banner(page: Page): Locator {
  return page.getByRole('main').locator('.ed-banner');
}

/**
 * Replaces the text of a CodeMirror editor: the editor the locator names, or the one inside it. Typed
 * through insertText, so brackets are not auto-closed.
 */
export async function setCode(page: Page, editor: Locator, text: string): Promise<void> {
  const content = (await editor.evaluate((el) => el.classList.contains('cm-content'))) ? editor : editor.locator('.cm-content');
  await content.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText(text);
}

/** The JSON tab's code editor. */
export function jsonEditor(page: Page, kindLabel: string): Locator {
  return page.getByRole('main').getByRole('textbox', { name: t('editor.json.label', { kind: kindLabel }) });
}

/** The text a CodeMirror editor holds, line breaks included. */
export async function codeText(editor: Locator): Promise<string> {
  return editor.evaluate((el) => {
    const content = el.classList.contains('cm-content') ? el : el.querySelector('.cm-content');
    return [...(content?.querySelectorAll('.cm-line') ?? [])].map((line) => line.textContent ?? '').join('\n');
  });
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
