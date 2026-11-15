import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Obj } from '../api/types';
import { t } from '../i18n';
import { pathFor } from '../router/paths';
import { DEV_CONN, renderApp, resetApp, saveConnections } from '../test/app';
import type { FakeAdminOptions } from '../test/fakeAdmin';
import { getToasts, toast } from '../ui/toast';

beforeAll(async () => {
  await import('./CommandPalette');
});

afterEach(() => {
  resetApp();
});

const ROUTES: Obj[] = [
  { id: 'r1', name: 'web-a', uri: '/a' },
  { id: 'r2', name: 'web-b', uri: '/b' },
];
const UPSTREAMS: Obj[] = [{ id: 'u1', name: 'web-pool', nodes: [{ host: '10.0.0.1', port: 80, weight: 1 }] }];

async function open(hash = '#/routes', opts: FakeAdminOptions = {}, connections = [DEV_CONN]) {
  saveConnections(connections, DEV_CONN.id);
  const user = userEvent.setup();
  const app = renderApp({ hash, counts: {}, objects: { routes: ROUTES, upstreams: UPSTREAMS }, ...opts });
  await screen.findByRole('main');
  return { user, ...app };
}

const dialog = () => screen.queryByRole('dialog', { name: t('palette.title') });
const box = () => screen.getByRole('combobox', { name: t('palette.input') });

async function openPalette(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard('{Control>}k{/Control}');
  await screen.findByRole('dialog', { name: t('palette.title') });
  return box();
}

/** The option aria-activedescendant points at. */
function active(): HTMLElement {
  const id = box().getAttribute('aria-activedescendant');
  const el = id ? document.getElementById(id) : null;
  if (!el) throw new Error('no active option');
  return el;
}

describe('opening and closing', () => {
  // Fix round 1, F1: a toast raised while the palette is open does not take its Escape.
  it('Esc closes it on the first press while a toast raised after it shows; the toast stays', async () => {
    const { user } = await open();
    await openPalette(user);
    act(() => toast.info('Copied'));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    expect(getToasts().map((item) => item.message)).toContain('Copied');
  });

  it('Ctrl-K opens it while focus is in an input, with focus in its search box; Esc closes it and focus goes back', async () => {
    const { user } = await open();
    const search = await screen.findByRole('searchbox', { name: t('table.search.label', { plural: t('kind.routes.plural') }) });
    await user.click(search);
    expect(await openPalette(user)).toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    await waitFor(() => expect(search).toHaveFocus());
    expect(search).toHaveValue('');
  });

  it('Ctrl-K inside the palette closes it (it toggles)', async () => {
    const { user } = await open();
    await openPalette(user);
    await user.keyboard('{Control>}k{/Control}');
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
  });

  it('Ctrl-K is taken from the browser (its default is prevented)', async () => {
    await open();
    const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(await screen.findByRole('dialog', { name: t('palette.title') })).toBeInTheDocument();
  });

  it('"/" opens it when focus is not in a field', async () => {
    const { user } = await open('#/upstreams/u1');
    await screen.findByRole('heading', { level: 1, name: 'web-pool' });
    await user.keyboard('/');
    expect(await screen.findByRole('dialog', { name: t('palette.title') })).toBeInTheDocument();
    expect(box()).toHaveValue('');
  });

  it('"/" is a character while typing in a field, and on a list it still goes to the list\'s own search', async () => {
    const { user } = await open();
    const search = await screen.findByRole('searchbox', { name: t('table.search.label', { plural: t('kind.routes.plural') }) });
    await user.keyboard('/');
    expect(search).toHaveFocus();
    await user.keyboard('/x');
    expect(search).toHaveValue('/x');
    expect(dialog()).not.toBeInTheDocument();
  });

  it('Ctrl-K also works where the K key types another letter (event.code KeyK), but not on a key that is another Latin letter', async () => {
    await open();
    fireEvent.keyDown(document.body, { key: 't', code: 'KeyK', ctrlKey: true });
    expect(dialog()).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'л', code: 'KeyK', ctrlKey: true });
    expect(await screen.findByRole('dialog', { name: t('palette.title') })).toBeInTheDocument();
  });

  it('neither Ctrl-K nor "/" opens it over another dialog or a menu: an open overlay owns the keyboard', async () => {
    // An editor page: "/" there opens the palette when nothing holds the keyboard.
    const { user } = await open('#/upstreams/u1');
    await screen.findByRole('heading', { level: 1, name: 'web-pool' });
    // A menu first: "/" and Ctrl-K on a menu item do nothing.
    await user.click(screen.getByRole('button', { name: t('editor.more') }));
    await screen.findByRole('menu');
    await user.keyboard('/');
    await user.keyboard('{Control>}k{/Control}');
    expect(dialog()).not.toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: t('action.delete') }));
    // Then the confirmation dialog (Delete), focus on its Cancel button.
    const confirm = await screen.findByRole('alertdialog');
    await user.keyboard('{Control>}k{/Control}');
    await user.keyboard('/');
    expect(dialog()).not.toBeInTheDocument();
    // Focus away from the dialog (on the page body) changes nothing while it is open.
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(document.body, { key: 'k', code: 'KeyK', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: '/', code: 'Slash' });
    expect(dialog()).not.toBeInTheDocument();
    expect(confirm).toBeInTheDocument();
    // Once it is gone, Ctrl-K opens the palette again.
    await user.click(within(confirm).getByRole('button', { name: t('ui.cancel') }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    await openPalette(user);
  });

  it('held down, Ctrl-K repeats are kept from the browser and do not toggle it again', async () => {
    await open();
    const repeat = new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, repeat: true, bubbles: true, cancelable: true });
    document.body.dispatchEvent(repeat);
    expect(repeat.defaultPrevented).toBe(true);
    expect(dialog()).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'k', code: 'KeyK', ctrlKey: true });
    await screen.findByRole('dialog', { name: t('palette.title') });
    const again = new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, repeat: true, bubbles: true, cancelable: true });
    box().dispatchEvent(again);
    expect(again.defaultPrevented).toBe(true);
    expect(dialog()).toBeInTheDocument();
  });

  it('a refused Ctrl-K is still taken from the browser', async () => {
    const { user } = await open('#/upstreams/u1');
    await screen.findByRole('heading', { level: 1, name: 'web-pool' });
    await user.click(screen.getByRole('button', { name: t('editor.more') }));
    await user.click(await screen.findByRole('menuitem', { name: t('action.delete') }));
    await screen.findByRole('alertdialog');
    const event = new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(dialog()).not.toBeInTheDocument();
  });

  it('only modal overlays hold its keys: a kit dialog, select or menu does; a list that is not modal (code completions, a lint panel) does not', async () => {
    const { user } = await open();
    // The kit Select (rows per page) is open.
    await user.click(await screen.findByRole('combobox', { name: t('table.page.size') }));
    await screen.findByRole('listbox', { name: t('table.page.size') });
    await user.keyboard('{Control>}k{/Control}');
    expect(dialog()).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    // A kit Dialog (View JSON) is open.
    await user.click(screen.getByRole('button', { name: t('table.actionsFor', { name: 'web-a' }) }));
    await user.click(await screen.findByRole('menuitem', { name: t('action.viewJson') }));
    const json = await screen.findByRole('dialog');
    await user.keyboard('{Control>}k{/Control}');
    expect(screen.queryByRole('dialog', { name: t('palette.title') })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(json).not.toBeInTheDocument());
    // A listbox in the page that is no overlay, as CodeMirror draws its completions and lint panel.
    const list = document.createElement('ul');
    list.setAttribute('role', 'listbox');
    list.innerHTML = '<li role="option">completion</li>';
    screen.getByRole('main').append(list);
    await openPalette(user);
    list.remove();
  });

  it('the hints say what "/" does here: it opens the palette, except on a list, where it searches the list', async () => {
    const { user } = await open('#/upstreams/u1');
    await screen.findByRole('heading', { level: 1, name: 'web-pool' });
    await openPalette(user);
    const hints = () => document.querySelector('.cp-hints');
    expect(hints()).toHaveTextContent(t('palette.hint.slash'));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(dialog()).not.toBeInTheDocument());
    await user.click(within(screen.getByRole('navigation', { name: t('shell.nav') })).getByRole('link', { name: /^Upstreams/ }));
    await screen.findByRole('searchbox', { name: t('table.search.label', { plural: t('kind.upstreams.plural') }) });
    await openPalette(user);
    expect(hints()).not.toHaveTextContent(t('palette.hint.slash'));
  });

  it('the header button opens it and shows the shortcut', async () => {
    const { user } = await open();
    const button = screen.getByRole('button', { name: t('palette.open') });
    expect(button).toHaveTextContent(t('palette.shortcut.other'));
    await user.click(button);
    expect(await screen.findByRole('dialog', { name: t('palette.title') })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(button).toHaveFocus());
  });
});

describe('moving through the results', () => {
  it('Up/Down move and wrap; Home/End; hover sets the active row', async () => {
    const { user } = await open();
    await openPalette(user);
    await user.type(box(), 'web');
    await screen.findByRole('option', { name: /^web-pool/ });
    const names = () => screen.getAllByRole('option').map((o) => o.textContent ?? '');
    expect(names()).toEqual([expect.stringMatching(/^web-a/), expect.stringMatching(/^web-b/), expect.stringMatching(/^web-pool/)]);
    expect(active()).toHaveTextContent(/^web-a/);
    await user.keyboard('{ArrowDown}');
    expect(active()).toHaveTextContent(/^web-b/);
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(active()).toHaveTextContent(/^web-a/);
    await user.keyboard('{ArrowUp}');
    expect(active()).toHaveTextContent(/^web-pool/);
    await user.keyboard('{Home}');
    expect(active()).toHaveTextContent(/^web-a/);
    await user.keyboard('{End}');
    expect(active()).toHaveTextContent(/^web-pool/);
    await user.hover(screen.getByRole('option', { name: /^web-b/ }));
    expect(active()).toHaveTextContent(/^web-b/);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(window.location.hash).toBe(`#${pathFor('routes', 'r2')}`));
  });

  it('PageDown in the last group goes to its last row', async () => {
    const { user } = await open('#/routes', { objects: { routes: ROUTES, upstreams: [...UPSTREAMS, { id: 'u2', name: 'web-pool-2', nodes: [] }] } });
    await openPalette(user);
    await user.type(box(), 'web');
    await screen.findByRole('option', { name: /^web-pool-2/ });
    await user.keyboard('{PageDown}');
    expect(active()).toHaveTextContent(/^web-pool$|^web-pool[^-]/);
    await user.keyboard('{PageDown}');
    expect(active()).toHaveTextContent(/^web-pool-2/);
    await user.keyboard('{PageDown}');
    expect(active()).toHaveTextContent(/^web-pool-2/);
  });

  it('PageDown / PageUp move by group', async () => {
    const { user } = await open();
    await openPalette(user);
    await user.type(box(), 'web');
    await screen.findByRole('option', { name: /^web-pool/ });
    await user.keyboard('{PageDown}');
    expect(active()).toHaveTextContent(/^web-pool/);
    await user.keyboard('{ArrowUp}{PageUp}');
    expect(active()).toHaveTextContent(/^web-a/);
  });

  it('Ctrl-Enter opens the object in a new browser tab, by its hash URL', async () => {
    const opened = vi.fn<(url?: string | URL, target?: string, features?: string) => Window | null>(() => null);
    vi.stubGlobal('open', opened);
    const { user } = await open();
    await openPalette(user);
    await user.type(box(), 'web-pool');
    await screen.findByRole('option', { name: /^web-pool/ });
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(opened).toHaveBeenCalledWith(new URL(`#${pathFor('upstreams', 'u1')}`, window.location.href).href, '_blank', 'noopener');
    expect(window.location.hash).toBe('#/routes');
  });

  it('Ctrl-Enter is offered only on a row that opens a page; elsewhere it does nothing, and the hint says nothing about it', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const opened = vi.fn(() => null);
    vi.stubGlobal('open', opened);
    const { user } = await open();
    await openPalette(user);
    const hints = () => document.querySelector('.cp-hints');
    // Go to Routes opens a page: the hint is there.
    expect(active()).toHaveTextContent(t('palette.action.goTo', { plural: t('kind.routes.plural') }));
    expect(hints()).toHaveTextContent(t('palette.hint.newTab'));
    await user.type(box(), 'theme dark');
    expect(active()).toHaveTextContent(t('palette.action.theme', { theme: t('theme.dark') }));
    expect(hints()).not.toHaveTextContent(t('palette.hint.newTab'));
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(opened).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.theme).not.toBe('dark');
    expect(dialog()).toBeInTheDocument();
    delete document.documentElement.dataset.theme;
  });

  it('the hint names what Enter does on the active row: open, apply a theme, switch connection', async () => {
    const PROD = { id: 'prod', name: 'prod', baseUrl: 'https://prod.test:9180', key: 'prod-key' };
    const { user } = await open('#/routes', {}, [DEV_CONN, PROD]);
    await openPalette(user);
    const enter = () => document.querySelector('.cp-hints span:nth-child(2)');
    expect(active()).toHaveTextContent(t('palette.action.goTo', { plural: t('kind.routes.plural') }));
    expect(enter()).toHaveTextContent(t('palette.hint.open'));
    await user.type(box(), 'theme dark');
    expect(active()).toHaveTextContent(t('palette.action.theme', { theme: t('theme.dark') }));
    expect(enter()).toHaveTextContent(t('palette.hint.apply'));
    expect(enter()).not.toHaveTextContent(t('palette.hint.open'));
    await user.clear(box());
    await user.type(box(), 'switch prod');
    expect(active()).toHaveTextContent(t('palette.action.switch', { name: 'prod (prod.test:9180)' }));
    expect(enter()).toHaveTextContent(t('palette.hint.switch'));
    await user.clear(box());
    await user.type(box(), 'manage');
    expect(enter()).toHaveTextContent(t('palette.hint.open'));
  });

  it('typing, then a list arriving above, keeps the first row typed for highlighted: Enter opens it, not a neighbour', async () => {
    let release = () => {};
    const gate = new Promise<undefined>((resolve) => {
      release = () => resolve(undefined);
    });
    const { user } = await open('#/upstreams', {
      replies: { routes: (req) => (req.url.searchParams.get('page_size') === '500' ? gate : undefined) },
    });
    await openPalette(user);
    await user.type(box(), 'web');
    await screen.findByRole('option', { name: /^web-pool/ });
    expect(active()).toHaveTextContent(/^web-pool/);
    release();
    await screen.findByRole('option', { name: /^web-a/ });
    expect(active()).toHaveTextContent(/^web-pool/);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(window.location.hash).toBe(`#${pathFor('upstreams', 'u1')}`));
  });

  it('the active row stays on its object when a list arrives later and rows appear above it', async () => {
    let release = () => {};
    const gate = new Promise<undefined>((resolve) => {
      release = () => resolve(undefined);
    });
    const { user } = await open('#/upstreams', {
      objects: { routes: ROUTES, upstreams: [...UPSTREAMS, { id: 'u2', name: 'web-pool-2', nodes: [] }] },
      // The routes list (page_size 500) waits; the connection check and the support check do not.
      replies: { routes: (req) => (req.url.searchParams.get('page_size') === '500' ? gate : undefined) },
    });
    await openPalette(user);
    await user.type(box(), 'web');
    await screen.findByRole('option', { name: /^web-pool-2/ });
    expect(screen.getByRole('option', { name: t('palette.loading', { plural: t('kind.routes.plural') }) })).toBeInTheDocument();
    await user.keyboard('{ArrowDown}');
    expect(active()).toHaveTextContent(/^web-pool-2/);
    release();
    await screen.findByRole('option', { name: /^web-a/ });
    expect(active()).toHaveTextContent(/^web-pool-2/);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(window.location.hash).toBe(`#${pathFor('upstreams', 'u2')}`));
  });

  describe('the highlighted row stays in view when rows arrive above it', () => {
    const scrolled = vi.fn<(this: Element, arg?: boolean | ScrollIntoViewOptions) => void>();
    beforeAll(() => {
      // jsdom has no layout, and no scrollIntoView: record who asks to be shown.
      Element.prototype.scrollIntoView = function (this: Element, arg?: boolean | ScrollIntoViewOptions) {
        scrolled.call(this, arg);
      };
    });
    afterAll(() => {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    });

    /** Upstreams web-pool and web-pool-2 found by "web"; the routes (web-a, web-b) held until `release`. */
    async function heldRoutes() {
      let release = () => {};
      const gate = new Promise<undefined>((resolve) => {
        release = () => resolve(undefined);
      });
      const app = await open('#/upstreams', {
        objects: { routes: ROUTES, upstreams: [...UPSTREAMS, { id: 'u2', name: 'web-pool-2', nodes: [] }] },
        replies: { routes: (req) => (req.url.searchParams.get('page_size') === '500' ? gate : undefined) },
      });
      await openPalette(app.user);
      await app.user.type(box(), 'web');
      await screen.findByRole('option', { name: /^web-pool-2/ });
      return { ...app, release };
    }
    const shown = () => scrolled.mock.contexts;

    it('typed: the first row, pushed down by the routes, is scrolled back into view', async () => {
      const { release } = await heldRoutes();
      expect(active()).toHaveTextContent(/^web-pool$|^web-pool[^-]/);
      scrolled.mockClear();
      release();
      await screen.findByRole('option', { name: /^web-a/ });
      expect(active()).toHaveTextContent(/^web-pool$|^web-pool[^-]/);
      await waitFor(() => expect(shown()).toContain(active()));
    });

    it('after ArrowDown: the chosen row, pushed down by the routes, is scrolled back into view', async () => {
      const { user, release } = await heldRoutes();
      await user.keyboard('{ArrowDown}');
      expect(active()).toHaveTextContent(/^web-pool-2/);
      scrolled.mockClear();
      release();
      await screen.findByRole('option', { name: /^web-a/ });
      expect(active()).toHaveTextContent(/^web-pool-2/);
      await waitFor(() => expect(shown()).toContain(active()));
    });

    it('a row the pointer highlighted is not scrolled under the pointer, but is brought back when rows push it away', async () => {
      const { user, release } = await heldRoutes();
      scrolled.mockClear();
      await user.hover(screen.getByRole('option', { name: /^web-pool-2/ }));
      expect(active()).toHaveTextContent(/^web-pool-2/);
      expect(shown()).toEqual([]);
      release();
      await screen.findByRole('option', { name: /^web-a/ });
      await waitFor(() => expect(shown()).toContain(active()));
    });
  });

  it('after Enter navigates, focus is on the page it opened', async () => {
    const { user } = await open();
    await openPalette(user);
    await user.type(box(), 'web-pool');
    await screen.findByRole('option', { name: /^web-pool/ });
    await user.keyboard('{Enter}');
    await screen.findByRole('heading', { level: 1, name: 'web-pool' });
    await waitFor(() => expect(screen.getByRole('main')).toHaveFocus());
  });
});

describe('ARIA', () => {
  it('a combobox controlling a listbox of grouped options; aria-activedescendant follows the active option', async () => {
    const { user } = await open();
    await openPalette(user);
    const input = box();
    expect(input).toHaveAttribute('aria-expanded', 'true');
    const listbox = screen.getByRole('listbox');
    expect(input).toHaveAttribute('aria-controls', listbox.id);
    await user.type(input, 'web');
    const routes = await within(listbox).findByRole('group', { name: t('kind.routes.plural') });
    const upstreams = within(listbox).getByRole('group', { name: t('kind.upstreams.plural') });
    const [first, second] = within(routes).getAllByRole('option');
    expect(input).toHaveAttribute('aria-activedescendant', first?.id);
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(second).toHaveAttribute('aria-selected', 'false');
    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', second?.id);
    expect(second).toHaveAttribute('aria-selected', 'true');
    expect(within(upstreams).getAllByRole('option')).toHaveLength(1);
    expect(within(screen.getByRole('dialog', { name: t('palette.title') })).getByRole('status')).toHaveTextContent(t('palette.count.other', { count: 3 }));
  });

  it('with nothing found the listbox is empty and collapsed', async () => {
    const { user } = await open();
    await openPalette(user);
    await user.type(box(), 'zzz-nothing');
    expect(await screen.findByText(t('palette.noResults', { query: 'zzz-nothing' }), { selector: 'p' })).toBeInTheDocument();
    expect(box()).toHaveAttribute('aria-expanded', 'false');
    expect(box()).not.toHaveAttribute('aria-activedescendant');
  });
});
