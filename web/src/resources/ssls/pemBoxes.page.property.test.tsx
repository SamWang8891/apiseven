// Property test of the PEM boxes' rule through the real editor frame (the whole app on the fake Admin
// API), in every place a box is used outside a dialog: the same actions, generator and model as the
// tab-level test (test/pemBoxRun.ts), and after every step its invariants (no whole private key in the
// markup outside the focused box; the box shows exactly the model's text). Asking to save presses
// Cmd/Ctrl-S or clicks Save / Create, so the frame leaves the focused box first and judges what the
// fields hold (useSaveRequest):
// - the model says held: no request, and the toast names the field;
// - else the value is missing or shorter than the schema's minimum (certificate_scheme 128,
//   private_key_schema 64; a reference is exempt), or in a new SSL's pair the other field is missing:
//   no request, and the toast names no held field;
// - else the request carries exactly the model's value (POST of a new SSL; PATCH of a stored one,
//   where a CA left as stored is not sent). A save that goes out ends the sequence.
// Every sequence runs to its end or its first failure; all failures are reported together.
// Two actions only the frame has (fix round 3 of Task 15): a remount (switch to another tab and back:
// the box's component state is lost, and what it shows must follow from the draft), and a save
// APISIX refuses late (a delayed 400: the fields are locked meanwhile, then editable again), each
// followed by the same checks. In a new SSL's pair a combined text offers the split (Task 16 B23):
// a request then carries both parts, each where the model put it. Text the other box does not take
// may be typed there (fix round 2, R8): a save is then refused for that box, and the split's name
// says it replaces that text; "Enter the private key" shows only without an offer (R11). Task 16b: a
// combined text there makes the other box offer, which this box's messages point at (item 145); a
// file read left pending is ignored once anything happened in the box, a remount included, and a save
// in flight in every place, as a lock makes it stale whether or not the box's input stays (item 147;
// fix round 1, R3.2; fix round 2, I1). Where the input is gone while locked (the CA's details, a key
// box's line), a refused file's reason goes, and an offer that file made goes with it (fix round 2,
// R1.2).
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
import { BoxRun, Coverage, actionsFor, firstFailure, held, newModel, staleReads, takes, type Kind, type Model } from '../../test/pemBoxRun';
import { json, type FakeRequest } from '../../test/fakeAdmin';
import { prng } from '../../test/prng';
import { SEED_CERT, SEED_KEY } from '../../test/sslSeed';
import { getToasts } from '../../ui/toast';
import { fingerprintOf } from './fingerprint';
import { newPathFor } from '../../router/paths';

beforeAll(async () => {
  await import('./bodies');
  await Promise.all([SEED_CERT, RSA_LEAF, EC_PAIR.cert].map(fingerprintOf));
});

const COMBINED = SEED_CERT + SEED_KEY;
/** While on, every write is answered late with APISIX's refusal (the refused-save action). */
const refusing = { on: false };
const REFUSAL = 'refused late by the test';
const refuse = (req: FakeRequest) =>
  refusing.on && req.method !== 'GET' ? new Promise<Response>((done) => setTimeout(() => done(json(400, { error_msg: REFUSAL })), 60)) : undefined;
const REPLIES = { ssls: refuse, 'ssls/apiseven-test': refuse };
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
  const app = await openEditor(`#${newPathFor('ssls')}?tab=snis`, { objects: NONE, replies: REPLIES });
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
  const app = await openEditor('#/ssls/apiseven-test?tab=client', { objects: { ...NONE, ssls: [stored] }, replies: REPLIES });
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
  /** Asserts that the write carries the model's value for this field (and, in a pair, the other field's). */
  sent: (write: { method: string; body?: Obj }, m: Model) => void;
  /** The tab the box is on (a remount switches away from it and back). */
  tab: () => string;
  /**
   * A certificate box's value it cannot show, after a remount: the stored CA holding a key (from the
   * frame), or for a new SSL a draft certificate holding one (fixed when the box mounts); none else.
   */
  hiddenAfterRemount?: (m: Model) => string | undefined;
  /** After a remount, with the value it cannot show in the draft, the box is reopened as the setup did (Replace CA). */
  reopen?: (app: App) => Promise<void>;
  /**
   * The locked view replaces the box (the CA shows its details), so a save in flight unmounts it: once
   * APISIX's refusal unlocks the fields, it shows what a remount shows (the field's value; rule 21).
   */
  lockedView?: true;
}

const certTab = () => t('ssl.tab.certificate');
const clientTab = () => t('ssl.tab.client');
const holdsKey = (v: string | undefined) => v !== undefined && /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(v);

/** A new SSL's POST: this box's value and the other box's of the pair. */
const posted = (field: 'cert' | 'key') => (write: { method: string; body?: Obj }, m: Model) => {
  expect(write.method, 'a POST').toBe('POST');
  expect(write.body?.[field], `the ${field} sent`).toBe(m.value);
  expect(write.body?.[field === 'cert' ? 'key' : 'cert'], 'the other field sent').toBe(m.other);
};
/** A PATCH sends the CA only when it changed: unsent, it stays `stored`. */
const patchedCa = (stored: string | undefined) => (write: { method: string; body?: Obj }, m: Model) => {
  expect(write.method, 'a PATCH').toBe('PATCH');
  const sent = (write.body?.client as Obj | undefined)?.ca;
  expect(sent === undefined ? stored : sent, 'the CA after the save').toBe(m.value);
};

const PLACES: Place[] = [
  {
    name: 'new SSL certificate',
    kind: 'cert',
    label: () => t('ssl.pem.cert'),
    setup: async () => ({ app: await newSsl({ key: SEED_KEY }), model: newModel('cert', undefined, '', undefined, { other: SEED_KEY }) }),
    sent: posted('cert'),
    tab: certTab,
    hiddenAfterRemount: (m) => (holdsKey(m.value) ? m.value : undefined),
  },
  {
    name: 'new SSL certificate over a draft one holding a key (from the JSON tab)',
    kind: 'cert',
    label: () => t('ssl.pem.cert'),
    setup: async () => {
      const app = await openEditor(`#${newPathFor('ssls')}`, { objects: NONE, replies: REPLIES });
      await settled();
      await app.user.click(tab(t('editor.json.tab')));
      const box = await jsonEditor(t('kind.ssls.singular'));
      await app.user.click(box);
      await app.user.keyboard('{Control>}a{/Control}');
      await app.user.paste(JSON.stringify({ status: 1, sni: 'p.apiseven.test', cert: COMBINED, key: SEED_KEY }));
      await app.user.click(tab(t('ssl.tab.certificate')));
      await settled();
      return { app, model: newModel('cert', COMBINED, '', COMBINED, { other: SEED_KEY }) };
    },
    sent: posted('cert'),
    tab: certTab,
    hiddenAfterRemount: (m) => (holdsKey(m.value) ? m.value : undefined),
  },
  {
    name: 'new SSL key, none entered',
    kind: 'key',
    label: () => t('ssl.pem.key'),
    setup: async () => ({ app: await newSsl({ cert: SEED_CERT }), model: newModel('key', undefined, '', undefined, { other: SEED_CERT }) }),
    sent: posted('key'),
    tab: certTab,
  },
  {
    name: 'new SSL key, one entered',
    kind: 'key',
    label: () => t('ssl.pem.key'),
    setup: async () => ({ app: await newSsl({ cert: SEED_CERT, key: EC_PAIR.key }), model: newModel('key', EC_PAIR.key, '', undefined, { other: SEED_CERT }) }),
    sent: posted('key'),
    tab: certTab,
  },
  {
    // The certificate box with no key entered: its split names text in the key box alone (R8).
    name: 'new SSL certificate, no key',
    kind: 'cert',
    label: () => t('ssl.pem.cert'),
    setup: async () => ({ app: await newSsl({}), model: newModel('cert', undefined, '', undefined, { other: undefined }) }),
    sent: posted('cert'),
    tab: certTab,
    hiddenAfterRemount: (m) => (holdsKey(m.value) ? m.value : undefined),
  },
  {
    // The key box with no certificate entered: its split names text in the certificate box alone (R8).
    name: 'new SSL key, no certificate',
    kind: 'key',
    label: () => t('ssl.pem.key'),
    setup: async () => ({ app: await newSsl({}), model: newModel('key', undefined, '', undefined, { other: undefined }) }),
    sent: posted('key'),
    tab: certTab,
  },
  {
    name: 'CA, none',
    kind: 'cert',
    label: () => t('ssl.client.ca'),
    lockedView: true,
    setup: async () => ({ app: await storedCa(undefined), model: newModel('cert', undefined, '') }),
    sent: patchedCa(undefined),
    tab: clientTab,
  },
  {
    name: 'CA, stored',
    kind: 'cert',
    label: () => t('ssl.client.ca'),
    lockedView: true,
    setup: async () => ({ app: await storedCa(SEED_CERT), model: newModel('cert', SEED_CERT, SEED_CERT) }),
    sent: patchedCa(SEED_CERT),
    tab: clientTab,
  },
  {
    name: 'CA, stored holding a key',
    kind: 'cert',
    label: () => t('ssl.client.ca'),
    lockedView: true,
    setup: async () => {
      const app = await storedCa(COMBINED);
      await app.user.click(main().getByRole('button', { name: t('ssl.client.replaceCa') }));
      // Opened by Replace CA; after a remount (the flag lost) it gives way to the details over the stored CA.
      return { app, model: { ...newModel('cert', COMBINED, '', COMBINED), closesOverHidden: true } };
    },
    sent: patchedCa(COMBINED),
    tab: clientTab,
    hiddenAfterRemount: () => COMBINED,
    reopen: async (app) => app.user.click(main().getByRole('button', { name: t('ssl.client.replaceCa') })),
  },
];

/** The schema's own refusal of a value the box took or kept: missing, or shorter than its minimum (a reference is exempt). */
const schemaRefuses = (kind: Kind, value: string | undefined) =>
  value === undefined || (!/^(?:\$secret:\/\/|\$env:\/\/)/i.test(value) && value.length < (kind === 'cert' ? 128 : 64));
/** In a new SSL's pair, the other field is required as well: refused while it has no value (a split gives it one). */
const pairRefuses = (m: Model) => m.pair && schemaRefuses(m.kind === 'cert' ? 'key' : 'cert', m.other);

/** A remount (the tab switched away and back): the box's own state is lost; it shows what the draft holds. */
function remounted(m: Model, place: Place): void {
  m.focused = false;
  m.opened = false;
  m.stood = null;
  // Session flags go with the box: an offered split, the "left out" line, a refused file's reason,
  // reads in progress (item 147); the other box's text and offer too.
  m.offer = undefined;
  m.leftOut = false;
  m.otherHeld = false;
  m.otherOffer = undefined;
  m.refused = false;
  staleReads(m);
  if (m.kind === 'key') {
    m.text = '';
    return;
  }
  m.hidden = place.hiddenAfterRemount?.(m);
  m.text = remountText(m);
  // Replace CA's flag goes with the field around the box (the setup's reopen gives it back where needed).
  m.hiddenOpen = false;
}

/** The box stays on the page while a save is in flight (a new SSL's certificate box); the key box and the CA give way to a locked view. */
const staysMounted = (place: Place): boolean => place.kind === 'cert' && place.lockedView !== true;

/** A certificate box mounted anew shows the field's value, or nothing for none or for the value it cannot show. */
const remountText = (m: Model): string => (m.kind === 'key' || m.value === undefined || m.value === m.hidden ? '' : m.value);

/** What a save would do with the box as the model has it: go out (true), or be refused before any request. */
const wouldSend = (place: Place, m: Model): boolean =>
  !held(m) && !m.otherHeld && !schemaRefuses(place.kind, m.value) && !pairRefuses(m) && (m.text.trim() === '' || takes(m.kind, m.text));

describe('every PEM box follows one rule through the real editor frame (property, seeded, page level)', () => {
  // 8 seeds since fix round 1 of Task 16b: the other box's offer and the files read late share the
  // steps, and this box's own split keeps its floor.
  const SEEDS = 8;
  const STEPS = 12;
  it(`${SEEDS} sequences of up to ${STEPS} steps in each of ${PLACES.length} places`, async () => {
    const cov = new Coverage();
    const failures: string[] = [];
    for (const place of PLACES) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const r = prng(seed * 104729 + place.name.length);
        const label = place.label();
        const heldPrefix = t('ui.pending.problem', { field: label, problem: '' });
        const otherPrefix = t('ui.pending.problem', { field: t(place.kind === 'cert' ? 'ssl.pem.key' : 'ssl.pem.cert'), problem: '' });
        let where = 'start';
        const failure = await firstFailure(async () => {
          const { app, model } = await place.setup();
          const { user, admin } = app;
          const run = new BoxRun(model, label, () => screen.getByRole('main'), user, cov);
          const m = run.m;
          const initialOther = m.other;
          m.focused = document.activeElement !== null && document.activeElement === run.box();
          const check = () => {
            run.check(where);
            if (m.pair) run.checkKeyNeeded(where);
          };
          check();
          cov.add(`place ${place.name}`);
          /** A save APISIX refuses late (a delayed 400): the fields are locked meanwhile, then editable again. */
          const refusedLate = async () => {
            const writes = writesOf(admin).length;
            refusing.on = true;
            fireEvent.keyDown(window, { key: 's', ctrlKey: true });
            run.leftByClick();
            await waitFor(() => expect(writesOf(admin).length, `${where}: a request`).toBe(writes + 1));
            expect((await screen.findAllByText(REFUSAL)).length, `${where}: APISIX's refusal shown`).toBeGreaterThan(0);
            refusing.on = false;
            // A box the locked view replaced meanwhile comes back as a remount shows it (only its text: the field around it kept the rest).
            if (place.lockedView) {
              if (m.text !== remountText(m)) cov.add('refusedSave: the box shows the value again');
              m.text = remountText(m);
            }
            // The lock made every read in progress stale, in every place (R3.2; fix round 2, I1), the box
            // staying on the page or not (fix round 3: counted apart where it stays).
            if (m.pending.length > 0) cov.add('a read pending at a save refused late');
            if (m.pending.length > 0 && staysMounted(place)) cov.add('a read pending at a save refused late, the box staying on the page');
            staleReads(m);
            // Its input was gone meanwhile (the CA's details; a key box reads as a line while locked): a
            // refused file's reason went, and an offer that file made with it (fix round 2, R1.2).
            if (place.lockedView || place.kind === 'key') {
              m.refused = false;
              if (m.offer?.from === 'file') {
                m.offer = undefined;
                cov.add("refusedSave: a file's offer went with its reason");
              }
            }
            const box = run.box();
            m.focused = box !== null && document.activeElement === box;
            cov.add('refusedSave');
            if (m.hidden !== undefined && m.value !== undefined && m.value !== m.hidden) cov.add('refusedSave: a value taken over one the box cannot show');
            check();
          };
          for (let step = 0; step < STEPS; step++) {
            if (await run.settleRead(r)) {
              where = `step ${step} (a pending read finished)`;
              check();
            }
            // The frame's own actions, now and then: a remount, a save APISIX refuses late. Once the box
            // has taken a value over one it cannot show (A1's case), or while a file read is pending (so
            // a save locks the page over it: fix round 2, I1), a refused-late save is likelier, and a user
            // action keeps a quarter: 0 a remount, 1–2 a save refused late, 3 a user action (fix round 1,
            // F3); otherwise a fifth each for the two, three fifths for a user action.
            const over = m.hidden !== undefined && m.value !== undefined && m.value !== m.hidden;
            const likelier = over || m.pending.length > 0;
            const draw = likelier ? r.int(4) : r.int(5);
            const frame = draw === 0 ? 0 : (likelier ? draw <= 2 : draw === 1) ? 1 : 2;
            if (over) cov.add(frame === 2 ? 'over a hidden value: a user action drawn' : 'over a hidden value: a frame action drawn');
            if (frame === 0 && !held(m) && !m.otherHeld) {
              where = `step ${step} (remount)`;
              await user.click(tab(t('ssl.tab.general')));
              await user.click(tab(place.tab()));
              await settled();
              remounted(m, place);
              if (place.reopen && m.value !== undefined && m.value === m.hidden) {
                // What the remount shows first: the stored CA's details in the box's place (fix round 3).
                check();
                await place.reopen(app);
                m.hiddenOpen = true;
              }
              cov.add('remount');
              check();
              continue;
            }
            if (frame === 1 && wouldSend(place, m)) {
              where = `step ${step} (a save refused late)`;
              await refusedLate();
              continue;
            }
            // Where the box stays on the page during a save (a new SSL's certificate box) and stands over no
            // value it cannot show (A1's place keeps its own draws), now and then (a user step in four that
            // could save) a file whose reading is left pending and at once a save refused late, so the page
            // is locked over that read: the case R3.2's lock rule changed (fix round 3).
            if (frame === 2 && staysMounted(place) && m.hidden === undefined && m.pending.length === 0 && wouldSend(place, m) && r.int(4) === 0) {
              where = `step ${step} (a file left pending, then a save refused late)`;
              run.slowOneIn = 1;
              const uploaded = await run.step('upload', r);
              run.slowOneIn = 3;
              if (uploaded) cov.add('upload');
              check();
              if (m.pending.length > 0 && wouldSend(place, m)) await refusedLate();
              continue;
            }
            // A save is likelier once a split gave the other box its part, so the request is checked to carry both.
            const splitDone = m.pair && m.other !== initialOther;
            const action = splitDone && wouldSend(place, m) && r.int(2) === 0 ? 'save' : run.next(r, true);
            where = `step ${step} (${action})`;
            if (action !== 'save') {
              if (await run.step(action, r)) cov.add(action);
              check();
              continue;
            }
            cov.add('save');
            // A user's key presses are separate tasks; two refusals in one task are one (Editor, fix round 1 R3.7).
            await new Promise((resolve) => setTimeout(resolve, 0));
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
            if (held(m) || m.otherHeld) {
              // The toast names a held field: this one, or the other box of the pair (either, when both are).
              const named = [held(m) ? heldPrefix : undefined, m.otherHeld ? otherPrefix : undefined].filter((p): p is string => p !== undefined);
              expect(writesOf(admin).length, `${where}: held, so no request`).toBe(writes);
              expect(told.some((item) => named.some((p) => item.message.includes(p))), `${where}: the toast names a held field`).toBe(true);
              cov.add(held(m) ? 'save: refused, held' : 'save: refused, the other box held');
            } else if (schemaRefuses(place.kind, m.value) || pairRefuses(m)) {
              expect(writesOf(admin).length, `${where}: the schema refuses the value, so no request`).toBe(writes);
              expect(told.length > 0 && told.every((item) => !item.message.includes(heldPrefix)), `${where}: refused for an issue, not a hold`).toBe(true);
              cov.add('save: refused, an issue');
            } else {
              await waitFor(() => expect(writesOf(admin).length, `${where}: a request`).toBe(writes + 1));
              place.sent(writesOf(admin).at(-1) as { method: string; body?: Obj }, m);
              if (m.pair && m.other !== initialOther) cov.add('save: sent after a split');
              if (m.hidden !== undefined && m.value !== undefined && m.value !== m.hidden) cov.add('save: sent, body checked, over a value the box cannot show');
              cov.add('save: sent');
              break;
            }
            // Where the frame puts the focus after a refusal is its own (the held field, or the one left).
            const box = run.box();
            m.focused = box !== null && document.activeElement === box;
            check();
          }
        });
        if (failure) failures.push(`${place.name}, seed ${seed}, ${where}: ${failure.replace(`${where}: `, '')}`);
        refusing.on = false;
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
    expect(cov.get('remount')).toBeGreaterThan(20);
    expect(cov.get('refusedSave')).toBeGreaterThan(10);
    expect(cov.get('refusedSave: a value taken over one the box cannot show')).toBeGreaterThan(2);
    expect(cov.get('unfocused arrival of key material not taken')).toBeGreaterThan(20);
    expect(cov.get('split from the cert box') + cov.get('split from the key box')).toBeGreaterThan(8);
    expect(cov.get("split by the cert box's action") + cov.get("split by the key box's action")).toBeGreaterThan(8);
    // F3 (fix round 1): user actions keep a share over a hidden value, and a body-checked save goes out there.
    expect(cov.get('over a hidden value: a user action drawn')).toBeGreaterThan(5);
    expect(cov.get('save: sent, body checked, over a value the box cannot show')).toBeGreaterThan(0);
    expect(cov.get('save: sent after a split')).toBeGreaterThan(2);
    expect(cov.get('a refused combined file over held text')).toBeGreaterThan(2);
    expect(cov.get('save: refused, the other box held')).toBeGreaterThan(2);
    for (const kind of ['cert', 'key']) expect(cov.get(`the ${kind} box's split names text in the other box`), kind).toBeGreaterThan(0);
    // Task 16b through the frame: the other box's offer (item 145), reads left pending (item 147).
    expect(cov.get('the other box offers')).toBeGreaterThan(4);
    expect(cov.get("this box's messages point at the other box's action")).toBeGreaterThan(3);
    expect(cov.get('upload: read left pending')).toBeGreaterThan(6);
    expect(cov.get('a pending read finished')).toBeGreaterThan(2);
    expect(cov.get('a stale read ignored')).toBeGreaterThan(2);
    // Fix round 2: a save locks the page over a pending read (I1).
    expect(cov.get('a read pending at a save refused late')).toBeGreaterThan(0);
    // Fix round 3: also where the box stays on the page during the save, the case R3.2 changed.
    expect(cov.get('a read pending at a save refused late, the box staying on the page')).toBeGreaterThan(2);
    // Fix round 3: the CA box that gave way to the stored CA's details is checked for what shows.
    expect(cov.get("the stored CA's details stand in for the box")).toBeGreaterThan(2);
    // Final wave M4: a key box holds text over a value taken in it since editing began, which stays its value.
    expect(cov.get('key held over a value taken in the box')).toBeGreaterThan(0);
  }, 300_000);
});
