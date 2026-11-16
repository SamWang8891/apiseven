// Property test of the PEM boxes' rule (PemBoxes.tsx, pemBox.ts) at tab level (renderTab, no editor
// frame), in every place a box is used: random sequences of what a user does to a box (test/pemBoxRun.ts:
// text typed or pasted with focus, dropped on the box or its upload bar without focus or on it with
// focus, a drop with nothing in it, each kind of file by a real click on Upload file, empty, leave,
// return, Keep the entered key, Remove) and after every step:
// 1. no whole private-key block is in the markup unless the textarea that holds it is the focused
//    element;
// 2. the box shows exactly the model's text, and is open or closed as the model says; outside a
//    dialog, the field is held (a pending entry names it) exactly when the model says so, and the
//    draft's value is the model's; in a dialog, the primary action is enabled exactly when the model
//    says both values are taken and nothing is held;
// 3. in a dialog, asking to save presses the primary action: off when the model says not ready; when
//    ready, the dialog's result is the model's {cert, key} exactly, and a fresh dialog continues the
//    sequence. (Saving outside a dialog goes through the real editor frame:
//    pemBoxes.page.property.test.tsx.)
// In a pair (a new SSL, the dialog) a combined text or file offers the split (Task 16 B23): the
// action, when the model offers it, gives each part to its box, so the other field's value is
// checked after every step too. Text the other box does not take may be typed there (fix round 2,
// R8): it holds that box, and the split's name says it replaces it, telling a value from text (Task
// 16b, item 143); a combined text there makes the other box offer, and this box's messages point at
// that action (item 145). In a new SSL the line "Enter the private key" shows exactly while the pair
// has a certificate, no key and no offer (fix round 2, R11). A refused file that offers nothing
// leaves the text's own offer (item 144); a file read left pending is ignored once anything happened
// in the box (item 147). Every sequence runs to its end or its first failure; all failures are
// reported together.
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Obj } from '../../api/types';
import { t } from '../../i18n';
import { RSA_LEAF } from '../../test/certs';
import { itemOf } from '../../test/ctx';
import { BoxRun, Coverage, FILE_NAMES, TEXT_NAMES, actionsFor, firstFailure, held, newModel, type Kind, type Model } from '../../test/pemBoxRun';
import { prng } from '../../test/prng';
import { SEED_CERT, SEED_KEY } from '../../test/sslSeed';
import { renderTab } from '../../test/tab';
import { CertificateTab } from './CertificateTab';
import { ClientTab } from './ClientTab';
import { fingerprintOf } from './fingerprint';
import { sslIssues } from './validate';

beforeAll(async () => {
  await Promise.all([SEED_CERT, RSA_LEAF].map(fingerprintOf));
});

const COMBINED = SEED_CERT + SEED_KEY;
const STORED: Obj = { id: 's1', snis: ['a.test'], cert: SEED_CERT };
const caOf = (d: Obj) => (d.client as Obj | undefined)?.ca;
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

/** The pair dialog's other box, filled before the sequence starts (its value is then taken). */
interface DialogSide {
  fill: (dialog: HTMLElement) => void;
  /** What the other box holds once filled. */
  other: string;
}

/** What Apply must hand over: this box's value and the other box's, as the model has them. */
const resultOf = (m: Model) => (m.kind === 'cert' ? { cert: m.value, key: m.other } : { cert: m.other, key: m.value });

type Mounted = { harness: ReturnType<typeof renderTab>; model: Model };

interface Place {
  name: string;
  kind: Kind;
  label: () => string;
  /** Renders the tab (and opens what the box sits in); the model at the start. */
  setup: () => Mounted | Promise<Mounted>;
  /** The field's value in the draft (outside a dialog). */
  field?: (d: Obj) => unknown;
  /** In a pair outside a dialog: the other field's value in the draft. */
  other?: (d: Obj) => unknown;
  dialog?: DialogSide;
}

const replaceDialog = () => screen.getByRole('dialog', { name: t('ssl.replace.title') });
async function openDialog(harness: ReturnType<typeof renderTab>): Promise<HTMLElement> {
  await harness.user.click(screen.getByRole('button', { name: t('ssl.replace') }));
  return screen.findByRole('dialog', { name: t('ssl.replace.title') });
}
/** Pastes `text` into a box of the dialog (it is taken there). */
function fillBox(dialog: HTMLElement, label: string, text: string) {
  const box = within(dialog).getByRole<HTMLTextAreaElement>('textbox', { name: label });
  act(() => box.focus());
  fireEvent.change(box, { target: { value: text } });
}

const PLACES: Place[] = [
  {
    name: 'new SSL certificate',
    kind: 'cert',
    label: () => t('ssl.pem.cert'),
    field: (d) => d.cert,
    other: (d) => d.key,
    setup: () => ({ harness: renderTab('ssls', CertificateTab, { status: 1 }, sslIssues, { isNew: true }), model: newModel('cert', undefined, '', undefined, { other: undefined }) }),
  },
  {
    name: 'new SSL certificate over a draft one holding a key',
    kind: 'cert',
    label: () => t('ssl.pem.cert'),
    field: (d) => d.cert,
    other: (d) => d.key,
    setup: () => ({ harness: renderTab('ssls', CertificateTab, { status: 1, cert: COMBINED }, sslIssues, { isNew: true }), model: newModel('cert', COMBINED, '', COMBINED, { other: undefined }) }),
  },
  {
    name: 'new SSL key, none entered',
    kind: 'key',
    label: () => t('ssl.pem.key'),
    field: (d) => d.key,
    other: (d) => d.cert,
    setup: () => ({ harness: renderTab('ssls', CertificateTab, { status: 1, cert: SEED_CERT }, sslIssues, { isNew: true }), model: newModel('key', undefined, '', undefined, { other: SEED_CERT }) }),
  },
  {
    name: 'new SSL key, one entered',
    kind: 'key',
    label: () => t('ssl.pem.key'),
    field: (d) => d.key,
    other: (d) => d.cert,
    setup: () => ({ harness: renderTab('ssls', CertificateTab, { status: 1, cert: SEED_CERT, key: SEED_KEY }, sslIssues, { isNew: true }), model: newModel('key', SEED_KEY, '', undefined, { other: SEED_CERT }) }),
  },
  {
    // The key box with no certificate entered: its split names text in the certificate box alone (R8).
    name: 'new SSL key, no certificate',
    kind: 'key',
    label: () => t('ssl.pem.key'),
    field: (d) => d.key,
    other: (d) => d.cert,
    setup: () => ({ harness: renderTab('ssls', CertificateTab, { status: 1 }, sslIssues, { isNew: true }), model: newModel('key', undefined, '', undefined, { other: undefined }) }),
  },
  {
    name: 'CA, none',
    kind: 'cert',
    label: () => t('ssl.client.ca'),
    field: caOf,
    setup: () => ({ harness: renderTab('ssls', ClientTab, { ...STORED, client: {} }, sslIssues, { original: itemOf('s1', STORED) }), model: newModel('cert', undefined, '') }),
  },
  {
    name: 'CA, stored',
    kind: 'cert',
    label: () => t('ssl.client.ca'),
    field: caOf,
    setup: () => {
      const draft = { ...STORED, client: { ca: SEED_CERT } };
      return { harness: renderTab('ssls', ClientTab, draft, sslIssues, { original: itemOf('s1', draft) }), model: newModel('cert', SEED_CERT, SEED_CERT) };
    },
  },
  {
    name: 'CA, stored holding a key',
    kind: 'cert',
    label: () => t('ssl.client.ca'),
    field: caOf,
    setup: async () => {
      const draft = { ...STORED, client: { ca: COMBINED } };
      const harness = renderTab('ssls', ClientTab, draft, sslIssues, { original: itemOf('s1', draft) });
      await harness.user.click(screen.getByRole('button', { name: t('ssl.client.replaceCa') }));
      return { harness, model: newModel('cert', COMBINED, '', COMBINED) };
    },
  },
  {
    name: 'dialog certificate',
    kind: 'cert',
    label: () => t('ssl.pem.cert'),
    dialog: { fill: (dialog) => fillBox(dialog, t('ssl.pem.key'), SEED_KEY), other: SEED_KEY },
    setup: () => ({ harness: renderTab('ssls', CertificateTab, STORED, sslIssues, { original: itemOf('s1', STORED) }), model: newModel('cert', undefined, '', undefined, { other: SEED_KEY }) }),
  },
  {
    name: 'dialog key',
    kind: 'key',
    label: () => t('ssl.pem.key'),
    dialog: { fill: (dialog) => fillBox(dialog, t('ssl.pem.cert'), RSA_LEAF), other: RSA_LEAF },
    setup: () => ({ harness: renderTab('ssls', CertificateTab, STORED, sslIssues, { original: itemOf('s1', STORED) }), model: newModel('key', undefined, '', undefined, { other: RSA_LEAF }) }),
  },
];

describe('every PEM box follows one rule (property, seeded, tab level)', () => {
  // 18 seeds since fix round 2 added an action (text in the other box): the older actions keep their counts.
  const SEEDS = 18;
  const STEPS = 14;
  it(`${SEEDS} sequences of ${STEPS} steps in each of ${PLACES.length} places`, async () => {
    const cov = new Coverage();
    const failures: string[] = [];
    for (const place of PLACES) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const r = prng(seed * 7919 + place.name.length);
        const label = place.label();
        let where = 'start';
        const failure = await firstFailure(async () => {
          const { harness, model } = await place.setup();
          const side = place.dialog;
          if (side) side.fill(await openDialog(harness));
          const scope = () => (side ? replaceDialog() : document.body);
          const run = new BoxRun(model, label, scope, harness.user, cov);
          const m = run.m;
          const apply = () => within(scope()).getByRole<HTMLButtonElement>('button', { name: t('ssl.replace.apply') });
          const ready = () => m.value !== undefined && m.other !== undefined && !held(m) && !m.otherHeld;
          const check = () => {
            run.check(where);
            if (side) {
              expect(apply().disabled, `${where}: the primary action is off`).toBe(!ready());
            } else {
              const pending = harness.held().filter((message) => message.startsWith(`${label}: `));
              expect(pending.length > 0, `${where}: held`).toBe(held(m));
              expect(str(place.field?.(harness.value())), `${where}: the field's value`).toBe(m.value);
              if (place.other) {
                expect(str(place.other(harness.value())), `${where}: the other field's value`).toBe(m.other);
                run.checkKeyNeeded(where);
              }
            }
          };
          check();
          cov.add(`place ${place.name}`);
          for (let step = 0; step < STEPS; step++) {
            if (await run.settleRead(r)) {
              where = `step ${step} (a pending read finished)`;
              check();
            }
            const action = run.next(r, side !== undefined);
            where = `step ${step} (${action})`;
            if (action === 'save') {
              // The dialog's primary action, pressed only when it is on (the check says when).
              if (!side || !ready()) {
                cov.add('save: off');
              } else {
                await harness.user.click(apply());
                run.leftByClick();
                const draft = harness.value();
                expect({ cert: draft.cert, key: draft.key }, `${where}: the dialog's result`).toEqual(resultOf(m));
                cov.add('save: applied');
                if (m.other !== side.other) cov.add('save: applied after a split');
                // A fresh dialog, and the model as it starts, so the sequence goes on; reads still in
                // progress in the closed dialog's box went with it (item 147).
                run.dropReads();
                side.fill(await openDialog(harness));
                Object.assign(m, newModel(place.kind, undefined, '', undefined, { other: side.other }));
              }
              cov.add('save');
            } else if (await run.step(action, r)) cov.add(action);
            check();
          }
        });
        if (failure) failures.push(`${place.name}, seed ${seed}, ${where}: ${failure.replace(`${where}: `, '')}`);
        cleanup();
      }
    }
    // The coverage counters, on request: PEM_COVERAGE=1 npx vitest run src/resources/ssls/pemBoxes.property.test.tsx --silent=false
    if ((import.meta.env as Record<string, string | undefined>).PEM_COVERAGE === '1') console.info(`PEM boxes, tab level: ${JSON.stringify(cov.counts)}`);
    expect(failures).toEqual([]);
    // Keep and Remove exist in the key places only, save in the dialogs only, and split where a combined text was given to a pair's box.
    const AT_LEAST: Record<string, number> = { keep: 20, remove: 8, save: 30, leave: 50, split: 30, otherText: 40 };
    for (const action of actionsFor('key', true)) expect(cov.get(action), action).toBeGreaterThan(AT_LEAST[action] ?? 150);
    for (const name of TEXT_NAMES) expect(cov.get(`text ${name}`), `text ${name}`).toBeGreaterThan(15);
    for (const name of FILE_NAMES) expect(cov.get(`file ${name}`), `file ${name}`).toBeGreaterThan(5);
    expect(cov.get('unfocused arrival of key material not taken')).toBeGreaterThan(100);
    expect(cov.get('save: applied')).toBeGreaterThan(8);
    expect(cov.get('split from the cert box')).toBeGreaterThan(10);
    expect(cov.get('split from the key box')).toBeGreaterThan(10);
    // By the box whose action it is, this box's or the other's (fix round 1, R3.4).
    expect(cov.get("split by the cert box's action")).toBeGreaterThan(10);
    expect(cov.get("split by the key box's action")).toBeGreaterThan(10);
    expect(cov.get('split offered for a refused file')).toBeGreaterThan(5);
    expect(cov.get('a refused combined file over held text')).toBeGreaterThan(5);
    for (const kind of ['cert', 'key']) {
      expect(cov.get(`the ${kind} box's split names text in the other box`), kind).toBeGreaterThan(3);
      expect(cov.get(`split from the ${kind} box over text in the other box`), kind).toBeGreaterThan(3);
    }
    expect(cov.get('save: applied after a split')).toBeGreaterThan(0);
    // Task 16b: a refused file beside the text's offer (144); the other box offering, and this box
    // pointing at its action (145); reads left pending, finished fresh or stale (147); a value and text
    // named apart in the split's name (143).
    expect(cov.get("a refused file left the text's offer")).toBeGreaterThan(5);
    expect(cov.get('the other box offers')).toBeGreaterThan(30);
    expect(cov.get('split from the other box')).toBeGreaterThan(15);
    expect(cov.get("this box's messages point at the other box's action")).toBeGreaterThan(20);
    expect(cov.get('upload: read left pending')).toBeGreaterThan(40);
    expect(cov.get('a pending read finished')).toBeGreaterThan(10);
    expect(cov.get('a stale read ignored')).toBeGreaterThan(10);
    expect(cov.get('a pending read finished, unreadable')).toBeGreaterThan(0);
    expect(cov.get('a stale read ignored, unreadable')).toBeGreaterThan(0);
    expect(cov.get("a refused file's reason in full")).toBeGreaterThan(50);
    expect(cov.get('text:late file')).toBeGreaterThan(3);
    for (const kind of ['cert', 'key']) expect(cov.get(`the ${kind} box's split names a value and text in the other box`), kind).toBeGreaterThan(3);
    // Final wave M4: a key box holds text over a value taken in it since editing began (a reference), which stays its value.
    expect(cov.get('key held over a value taken in the box')).toBeGreaterThan(5);
    // Fix round 1, F1: what the page then says (the note names the reference; no Keep) is checked.
    expect(cov.get('the note names a value taken in the key box')).toBeGreaterThan(5);
    for (const place of PLACES) expect(cov.get(`place ${place.name}`), place.name).toBe(SEEDS);
  }, 300_000);
});
