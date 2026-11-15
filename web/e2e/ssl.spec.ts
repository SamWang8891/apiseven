// SSL certificates: upload a certificate and its key, edit the SNIs without the key, replace the pair;
// APISIX's HTTPS listener serves what is stored, and the private key is never in the page.
import { EC_PAIR, RSA_PAIR } from '../src/test/pairs';
import {
  Admin,
  create,
  deleteFromEditor,
  eventually,
  expect,
  idField,
  listShows,
  openEditor,
  openNew,
  openTab,
  save,
  servedCertificate,
  t,
  test,
  uid,
  unlock,
} from './fixtures';

const PREFIX = 'e2e-ssl-';
const SNI = 'rotated.apiseven.test';
/** A line from the middle of each private key: never in the page. */
const KEY_LINES = [EC_PAIR.key.split('\n')[2]!, RSA_PAIR.key.split('\n')[5]!];

test.afterAll(async () => {
  await new Admin().removePrefixed(PREFIX);
});

async function noKeyInPage(page: import('@playwright/test').Page): Promise<void> {
  const html = await page.content();
  for (const line of KEY_LINES) expect(html, 'a private key line in the page').not.toContain(line);
}

/** The common name of the certificate the HTTPS listener presents for `sni`, once it is `cn`. */
async function servedFor(sni: string, cn: string): Promise<void> {
  const cert = await eventually(
    () => servedCertificate(sni),
    (c) => c.subject?.CN === cn,
  );
  expect(cert.subject?.CN, `the certificate served for ${sni}`).toBe(cn);
}

test('upload a certificate and its key in the form: stored, served on the HTTPS port, and the key is never in the page', async ({ page, admin }) => {
  const id = `${PREFIX}${uid()}`;
  const main = await openNew(page, 'ssls/new');
  await idField(page).fill(id);
  const cert = await openTab(page, t('ssl.tab.certificate'));
  await cert.getByRole('textbox', { name: t('ssl.pem.cert') }).fill(EC_PAIR.cert);
  await cert.getByRole('textbox', { name: t('ssl.pem.key') }).fill(EC_PAIR.key);
  const snis = await openTab(page, t('ssl.tab.snis'));
  await noKeyInPage(page);
  await snis.getByRole('button', { name: t('ssl.snis.useSans') }).click();
  await expect(snis).toContainText(SNI);
  const write = await create(page);
  expect(write.body?.key).toBe(EC_PAIR.key);
  // One SNI is stored as sni (APISIX takes either; the editor writes one name as sni).
  expect(await admin.value(`ssls/${id}`)).toEqual({ id, status: 1, sni: SNI, cert: EC_PAIR.cert });
  await noKeyInPage(page);
  await expect(main.getByRole('tabpanel')).toContainText(t('ssl.key.stored'));
  await servedFor(SNI, SNI);

  await listShows(page, 'ssls', SNI);
  await admin.del(`ssls/${id}`);
});

// Each test uses SNIs of its own: APISIX serves one certificate per SNI, the first it loaded.
test('editing the SNIs sends a PATCH without the key, and the stored key still serves TLS', async ({ page, admin }) => {
  const id = `${PREFIX}${uid()}`;
  const sni = 'snis.apiseven.test';
  await admin.put(`ssls/${id}`, { type: 'server', snis: [sni], cert: EC_PAIR.cert, key: EC_PAIR.key });
  await servedFor(sni, SNI);
  await openEditor(page, `ssls/${id}?tab=snis`);
  await noKeyInPage(page);
  await unlock(page);
  const box = page.getByRole('main').getByRole('textbox', { name: t('ssl.snis.label') });
  await box.fill(`alt.${sni}`);
  await box.press('Enter');
  const write = await save(page);
  expect(write.method).toBe('PATCH');
  expect(write.body).not.toHaveProperty('key');
  expect(write.body).not.toHaveProperty('cert');
  expect((await admin.value(`ssls/${id}`))?.snis).toEqual([sni, `alt.${sni}`]);
  // A handshake for the new SNI completes with the stored key.
  await servedFor(`alt.${sni}`, SNI);
  await noKeyInPage(page);
  await admin.del(`ssls/${id}`);
});

test('Replace certificate sends the new certificate and key; APISIX then serves the new certificate; Delete removes it', async ({ page, admin }) => {
  const id = `${PREFIX}${uid()}`;
  const sni = 'replace.apiseven.test';
  await admin.put(`ssls/${id}`, { type: 'server', snis: [sni], cert: EC_PAIR.cert, key: EC_PAIR.key });
  await servedFor(sni, SNI);
  const main = await openEditor(page, `ssls/${id}`);
  await unlock(page);
  await main.getByRole('button', { name: t('ssl.replace') }).click();
  const dialog = page.getByRole('dialog', { name: t('ssl.replace.title') });
  await dialog.getByRole('textbox', { name: t('ssl.pem.cert') }).fill(RSA_PAIR.cert);
  await dialog.getByRole('textbox', { name: t('ssl.pem.key') }).fill(RSA_PAIR.key);
  await dialog.getByRole('button', { name: t('ssl.replace.apply') }).click();
  await expect(dialog).toBeHidden();
  await expect(main.getByRole('tabpanel')).toContainText(t('ssl.key.replaced'));
  await noKeyInPage(page);
  const write = await save(page);
  expect(write.method).toBe('PATCH');
  expect(write.body).toEqual({ cert: RSA_PAIR.cert, key: RSA_PAIR.key });
  expect((await admin.value(`ssls/${id}`))?.cert).toBe(RSA_PAIR.cert);
  await servedFor(sni, 'rsa-extra.apiseven.test');
  await noKeyInPage(page);

  await deleteFromEditor(page, t('kind.ssls.singular'));
  expect(await admin.value(`ssls/${id}`)).toBeUndefined();
  // Back to the seed's wildcard certificate.
  await servedFor(sni, 'apiseven.test');
});
