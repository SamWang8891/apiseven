// An address whose id is not one path segment once decoded (Task 16-2, R4): the Not found page with
// its link back, and no Admin API request that names the crafted id — no write, and no read either,
// since a decoded slash or dot segment would reach another object.
import { expect, t, test } from './fixtures';

const CASES: { hash: string; plural: string; forbidden: RegExp }[] = [
  { hash: '#/routes/a%2Fb', plural: t('kind.routes.plural'), forbidden: /routes\/a(%2F|\/)b/i },
  { hash: '#/routes/..%2Fupstreams%2Fx', plural: t('kind.routes.plural'), forbidden: /\.\.|upstreams(%2F|\/)x/i },
  // A credential under a crafted consumer: the create page as Task 16b will name it, and as it is now.
  { hash: '#/consumers/a%2Fcredentials%2Fk0/credentials/~new', plural: t('kind.consumers.plural'), forbidden: /consumers\/a(%2F|\/)|credentials(%2F|\/)k0/i },
  { hash: '#/consumers/a%2Fcredentials%2Fk0/credentials/new', plural: t('kind.consumers.plural'), forbidden: /consumers\/a(%2F|\/)|credentials(%2F|\/)k0/i },
];

for (const { hash, plural, forbidden } of CASES) {
  test(`${hash}: Not found with a link back, and no request names the crafted id`, async ({ page }) => {
    const named: string[] = [];
    page.on('request', (r) => {
      const url = r.url();
      if (url.includes('/apisix/admin/') && forbidden.test(url.slice(url.indexOf('/apisix/admin/')))) named.push(`${r.method()} ${url}`);
    });
    await page.goto(`/${hash}`);
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1, name: t('notFound.title') })).toBeVisible();
    await expect(main.getByText(hash.slice(1), { exact: true })).toBeVisible();
    const back = main.getByRole('link', { name: t('notFound.back', { plural }) });
    await expect(back).toBeVisible();
    // The shell's own reads have answered (the sidebar shows its counts), so a request the page made
    // for the crafted id would have been seen by now.
    const nav = page.getByRole('navigation', { name: t('shell.nav') });
    await expect(nav.getByRole('link', { name: new RegExp(`^${t('kind.routes.plural')} \\d+$`) })).toBeVisible();
    await expect(nav.getByRole('link', { name: new RegExp(`^${t('kind.protos.plural')} \\d+$`) })).toBeVisible();
    expect(named).toEqual([]);
    await back.click();
    await expect(main.getByRole('heading', { level: 1, name: plural })).toBeVisible();
    expect(named).toEqual([]);
  });
}
