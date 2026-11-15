// Property test of the PEM boxes' rule through the real editor frame (the whole app on the fake Admin
// API), in every place a box is used outside a dialog: the same actions, generator and model as the
// tab-level test (test/pemBoxRun.ts), and after every step its invariants (no whole private key in the
// markup outside the focused box; the box shows exactly the model's text). Asking to save presses
// Cmd/Ctrl-S or clicks Save / Create, so the frame leaves the focused box first and judges what the
// fields hold (useSaveRequest):
// - the model says held: no request, and the toast names the field;
// - else the value is missing or shorter than the schema's minimum (certificate_scheme 128,
//   private_key_schema 64; a reference is exempt): no request, and the toast names no held field;
// - else the request carries exactly the model's value (POST of a new SSL; PATCH of a stored one,
//   where a CA left as stored is not sent). A save that goes out ends the sequence.
// Every sequence runs to its end or its first failure; all failures are reported together.
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { beforeAll, describe, expect, it } from 'vitest';
import { resetReadOnlyKeys } from '../../api/write';
import type { Obj } from '../../api/types';
import { t } from '../../i18n';
import { resetApp } from '../../test/app';
import { RSA_LEAF } from '../../test/certs';
import { jsonEditor, main, openEditor, writesOf } from '../../test/editor';
import { EC_PAIR } from '../../test/pairs';
import { BoxRun, Coverage, actionsFor, firstFailure, held, newModel, type Kind, type Model } from '../../test/pemBoxRun';
import { prng } from '../../test/prng';
import { SEED_CERT, SEED_KEY } from '../../test/sslSeed';
import { getToasts } from '../../ui/toast';
import { fingerprintOf } from './fingerprint';

beforeAll(async () => {
  await import('./bodies');
  await Promise.all([SEED_CERT, RSA_LEAF, EC_PAIR.cert].map(fingerprintOf));
});

const COMBINED = SEED_CERT + SEED_KEY;
const STORED: Obj = { id: 'apiseven-test', type: 'server', snis: ['apiseven.test'], cert: SEED_CERT, key: SEED_KEY };
const NONE = { ssls: [], routes: [], services: [] };
const tab = (label: string) => main().getByRole('tab', { name: new RegExp(`^${label}`) });

async function settled() {
  const panel = await main().findByRole('tabpanel');
  await waitFor(() => expect(panel.querySelector('.ed-lazy__loading')).toBeNull());
}

/** Clicks into a box and pastes `text` (an empty box). */
async function fill(user: UserEvent, label: string, text: string) {
  await user.click(main().getByRole('textbox', { name: label }));
  await user.paste(text);
}

/** A new SSL with an SNI, back on the Certificate tab, its certificate and key as given. */
async function newSsl(pair: { cert?: string; key?: string }) {
  const app = await openEditor('#/ssls/new?tab=snis', { objects: NONE });
  await settled();
  await app.user.type(main().getByRole('textbox', { name: t('ssl.snis.label') }), 'p.apiseven.test{Enter}');
  await app.user.click(tab(t('ssl.tab.certificate')));
  await settled();
  if (pair.cert) await fill(app.user, t('ssl.pem.cert'), pair.cert);
  if (pair.key) await fill(app.user, t('ssl.pem.key'), pair.key);
  return app;
}

/** A stored SSL with this client CA, being edited on Client mTLS with its depth changed (so a save always writes). */
async function storedCa(ca: string | undefined) {
  const stored = ca === undefined ? STORED : { ...STORED, client: { ca, depth: 1 } };
  const app = await openEditor('#/ssls/apiseven-test?tab=client', { objects: { ...NONE, ssls: [stored] } });
  await main().findByRole('heading', { level: 1 });
  await settled();
  await app.user.keyboard('e');
  if (ca === undefined) await app.user.click(main().getByRole('switch', { name: t('ssl.client.enable') }));
  else {
    const depth = main().getByRole('spinbutton', { name: t('ssl.client.depth') });
    await app.user.clear(depth);
    await app.user.type(depth, '2');
  }
  return app;
}

type App = Awaited<ReturnType<typeof openEditor>>;

interface Place {
  name: string;
  kind: Kind;
  label: () => string;
  setup: () => Promise<{ app: App; model: Model }>;
  /** Asserts that the write carries `value` for this field. */
  sent: (write: { method: string; body?: Obj }, value: string | undefined) => void;
}

const posted = (field: 'cert' | 'key') => (write: { method: string; body?: Obj }, value: string | undefined) => {
  expect(write.method, 'a POST').toBe('POST');
  expect(write.body?.[field], `the ${field} sent`).toBe(value);
};
/** A PATCH sends the CA only when it changed: unsent, it stays `stored`. */
const patchedCa = (stored: string | undefined) => (write: { method: string; body?: Obj }, value: string | undefined) => {
  expect(write.method, 'a PATCH').toBe('PATCH');
  const sent = (write.body?.client as Obj | undefined)?.ca;
  expect(sent === undefined ? stored : sent, 'the CA after the save').toBe(value);
};

const PLACES: Place[] = [
  {
    name: 'new SSL certificate',
    kind: 'cert',
    label: () => t('ssl.pem.cert'),
    setup: async () => ({ app: await newSsl({ key: SEED_KEY }), model: newModel('cert', undefined, '') }),
    sent: posted('cert'),
  },
  {
    name: 'new SSL certificate over a draft one holding a key (from the JSON tab)',
    kind: 'cert',
    label: () => t('ssl.pem.cert'),
    setup: async () => {
      const app = await openEditor('#/ssls/new', { objects: NONE });
      await settled();
      await app.user.click(tab(t('editor.json.tab')));
      const box = await jsonEditor(t('kind.ssls.singular'));
      await app.user.click(box);
      await app.user.keyboard('{Control>}a{/Control}');
      await app.user.paste(JSON.stringify({ status: 1, sni: 'p.apiseven.test', cert: COMBINED, key: SEED_KEY }));
      await app.user.click(tab(t('ssl.tab.certificate')));
      await settled();
      return { app, model: newModel('cert', COMBINED, '', COMBINED) };
    },
    sent: posted('cert'),
  },
  {
    name: 'new SSL key, none entered',
    kind: 'key',
    label: () => t('ssl.pem.key'),
    setup: async () => ({ app: await newSsl({ cert: SEED_CERT }), model: newModel('key', undefined, '') }),
    sent: posted('key'),
  },
  {
    name: 'new SSL key, one entered',
    kind: 'key',
    label: () => t('ssl.pem.key'),
    setup: async () => ({ app: await newSsl({ cert: SEED_CERT, key: EC_PAIR.key }), model: newModel('key', EC_PAIR.key, '') }),
    sent: posted('key'),
  },
  {
    name: 'CA, none',
    kind: 'cert',
    label: () => t('ssl.client.ca'),
    setup: async () => ({ app: await storedCa(undefined), model: newModel('cert', undefined, '') }),
    sent: patchedCa(undefined),
  },
  {
    name: 'CA, stored',
    kind: 'cert',
    label: () => t('ssl.client.ca'),
    setup: async () => ({ app: await storedCa(SEED_CERT), model: newModel('cert', SEED_CERT, SEED_CERT) }),
    sent: patchedCa(SEED_CERT),
  },
  {
    name: 'CA, stored holding a key',
    kind: 'cert',
    label: () => t('ssl.client.ca'),
    setup: async () => {
      const app = await storedCa(COMBINED);
      await app.user.click(main().getByRole('button', { name: t('ssl.client.replaceCa') }));
      return { app, model: newModel('cert', COMBINED, '', COMBINED) };
    },
    sent: patchedCa(COMBINED),
  },
];

/** The schema's own refusal of a value the box took or kept: missing, or shorter than its minimum (a reference is exempt). */
const schemaRefuses = (kind: Kind, value: string | undefined) =>
  value === undefined || (!/^(?:\$secret:\/\/|\$env:\/\/)/i.test(value) && value.length < (kind === 'cert' ? 128 : 64));

describe('every PEM box follows one rule through the real editor frame (property, seeded, page level)', () => {
  const SEEDS = 6;
  const STEPS = 12;
  it(`${SEEDS} sequences of up to ${STEPS} steps in each of ${PLACES.length} places`, async () => {
    const cov = new Coverage();
    const failures: string[] = [];
    for (const place of PLACES) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const r = prng(seed * 104729 + place.name.length);
        const label = place.label();
        const heldPrefix = t('ui.pending.problem', { field: label, problem: '' });
        let where = 'start';
        const failure = await firstFailure(async () => {
          const { app, model } = await place.setup();
          const { user, admin } = app;
          const run = new BoxRun(model, label, () => screen.getByRole('main'), user, cov);
          const m = run.m;
          m.focused = document.activeElement !== null && document.activeElement === run.box();
          run.check(where);
          cov.add(`place ${place.name}`);
          for (let step = 0; step < STEPS; step++) {
            const action = run.next(r, true);
            where = `step ${step} (${action})`;
            if (action !== 'save') {
              if (await run.step(action, r)) cov.add(action);
              run.check(where);
              continue;
            }
            cov.add('save');
            const toastsBefore = getToasts().at(-1)?.id ?? 0;
            const writes = writesOf(admin).length;
            const how = r.int(3);
            if (how < 2) {
              fireEvent.keyDown(window, { key: 's', ...(how === 0 ? { metaKey: true } : { ctrlKey: true }) });
              cov.add(how === 0 ? 'save: Cmd-S' : 'save: Ctrl-S');
            } else {
              await user.click(main().getByRole('button', { name: t(place.name.startsWith('new') ? 'editor.create' : 'editor.save') }));
              cov.add('save: button');
            }
            // The frame left the box first (a blur), then judged it.
            run.leftByClick();
            const told = getToasts().filter((item) => item.id > toastsBefore);
            if (held(m)) {
              expect(writesOf(admin).length, `${where}: held, so no request`).toBe(writes);
              expect(told.some((item) => item.message.includes(heldPrefix)), `${where}: the toast names the field`).toBe(true);
              cov.add('save: refused, held');
            } else if (schemaRefuses(place.kind, m.value)) {
              expect(writesOf(admin).length, `${where}: the schema refuses the value, so no request`).toBe(writes);
              expect(told.length > 0 && told.every((item) => !item.message.includes(heldPrefix)), `${where}: refused for an issue, not a hold`).toBe(true);
              cov.add('save: refused, an issue');
            } else {
              await waitFor(() => expect(writesOf(admin).length, `${where}: a request`).toBe(writes + 1));
              place.sent(writesOf(admin).at(-1) as { method: string; body?: Obj }, m.value);
              cov.add('save: sent');
              break;
            }
            // Where the frame puts the focus after a refusal is its own (the held field, or the one left).
            const box = run.box();
            m.focused = box !== null && document.activeElement === box;
            run.check(where);
          }
        });
        if (failure) failures.push(`${place.name}, seed ${seed}, ${where}: ${failure.replace(`${where}: `, '')}`);
        cleanup();
        resetApp();
        resetReadOnlyKeys();
      }
    }
    // The coverage counters, on request: PEM_COVERAGE=1 npx vitest run src/resources/ssls/pemBoxes.page.property.test.tsx --silent=false
    if ((import.meta.env as Record<string, string | undefined>).PEM_COVERAGE === '1') console.info(`PEM boxes, page level: ${JSON.stringify(cov.counts)}`);
    expect(failures).toEqual([]);
    for (const place of PLACES) expect(cov.get(`place ${place.name}`), place.name).toBe(SEEDS);
    for (const action of actionsFor('cert', true)) expect(cov.get(action), action).toBeGreaterThan(8);
    expect(cov.get('save: refused, held')).toBeGreaterThan(5);
    expect(cov.get('save: sent')).toBeGreaterThan(5);
    expect(cov.get('unfocused arrival of key material not taken')).toBeGreaterThan(20);
  }, 300_000);
});
