// The owner's logo and favicon (task-brand-report.md), checked the same way in the preview build,
// in proxy mode and in the single file.
import { expect, type Page } from '@playwright/test';
import { t } from '../src/i18n';

/** Every icon and manifest link in the page's head, resolved against the page. */
export async function headLinks(page: Page): Promise<{ rel: string; href: string }[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="manifest"]')].map((l) => ({ rel: l.rel, href: l.href })),
  );
}

/**
 * The served modes: every icon link and the manifest answer 200, and so does each manifest icon
 * (resolved against the manifest's own URL).
 */
export async function expectIconsServed(page: Page): Promise<void> {
  const links = await headLinks(page);
  expect(links.map((l) => l.rel).sort()).toEqual(['apple-touch-icon', 'icon', 'icon', 'icon', 'manifest']);
  for (const { href } of links) {
    const res = await page.request.get(href);
    expect(res.status(), href).toBe(200);
  }
  const manifestUrl = links.find((l) => l.rel === 'manifest')!.href;
  const manifest = (await (await page.request.get(manifestUrl)).json()) as { name: string; icons: { src: string }[] };
  expect(manifest.name).toBe('apiseven');
  expect(manifest.icons.length).toBeGreaterThan(0);
  for (const icon of manifest.icons) {
    const url = new URL(icon.src, manifestUrl).href;
    const res = await page.request.get(url);
    expect(res.status(), url).toBe(200);
    expect(res.headers()['content-type']).toContain('image/png');
  }
}

/**
 * The mark beside the name: loaded (decoded, not a broken image), left of the name and centred on
 * it. The image is decorative (alt=""), so it has no accessible handle: it is the one image inside
 * the brand — the sidebar's home link, or on the Connect page the element whose text is the name.
 */
export async function expectMarkBesideName(page: Page, where: 'sidebar' | 'connect'): Promise<void> {
  const brand = where === 'sidebar' ? page.getByRole('link', { name: t('shell.home') }) : page.getByText(t('app.name'), { exact: true }).first();
  await expect(brand).toBeVisible();
  const mark = brand.locator('img');
  await expect(mark).toHaveCount(1);
  await expect(mark).toBeVisible();
  await expect.poll(() => mark.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  // The name is the brand's own text node, beside the image.
  const [m, n] = [(await mark.boundingBox())!, (await brand.evaluate((el) => {
    const range = document.createRange();
    const text = [...el.childNodes].find((c) => c.nodeType === Node.TEXT_NODE && c.textContent?.trim());
    if (!text) return null;
    range.selectNodeContents(text);
    const r = range.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }))!];
  expect(m.x + m.width, 'the mark ends before the name starts').toBeLessThanOrEqual(n.x + 0.5);
  expect(Math.abs(m.y + m.height / 2 - (n.y + n.height / 2)), 'the mark is centred on the name').toBeLessThanOrEqual(4);
}
