// Property test of the PEM boxes' rule (PemBoxes.tsx, pemBox.ts), in every place a box is used: random
// sequences of user actions (type or paste each kind of text, upload each kind of file, drop text,
// empty the box, leave it, return to it, ask to save) and after every step:
// 1. no whole private-key block is on the page (markup or a box's text) unless the box holding it has
//    focus;
// 2. either the field is held (a pending entry names it; a dialog's primary action is off), or its
//    value is exactly what the page says (a certificate or CA: the box's text, no value for an empty
//    box, or the stored value it cannot show with its note; a key: "entered" ⇔ a key, the last whole
//    key taken); and leaving a box never changes its text but for markers over key blocks;
// 3. asking to save (the frame's blur-then-save) is refused when held, else carries exactly that value.
// The reference below states the rule independently of the boxes' code.
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Obj } from '../../api/types';
import { t } from '../../i18n';
import { RSA_LEAF } from '../../test/certs';
import { itemOf } from '../../test/ctx';
import { EC_PAIR } from '../../test/pairs';
import { prng } from '../../test/prng';
import { SEED_CERT, SEED_KEY } from '../../test/sslSeed';
import { renderTab } from '../../test/tab';
import { CertificateTab } from './CertificateTab';
import { ClientTab } from './ClientTab';
import { fingerprintOf } from './fingerprint';
import { sslIssues } from './validate';

beforeAll(async () => {
  await Promise.all([SEED_CERT, RSA_LEAF, EC_PAIR.cert].map(fingerprintOf));
});

type Kind = 'cert' | 'key';
const ENCRYPTED = `-----BEGIN ENCRYPTED PRIVATE KEY-----\n${'E'.repeat(80)}\n-----END ENCRYPTED PRIVATE KEY-----\n`;
const COMBINED = SEED_CERT + SEED_KEY;
const KEY_BLOCKS = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g;
const WHOLE_KEY = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[^-]+-----END [A-Z0-9 ]*PRIVATE KEY-----/;
const ONE_KEY = /^-----BEGIN ((?:RSA |EC |DSA )?)PRIVATE KEY-----[^-]*-----END \1PRIVATE KEY-----$/;

/** The rule's own reading of a text: does a box of this kind take it? */
function takes(kind: Kind, text: string): boolean {
  if (text.trim() === '' || text.includes('•')) return false;
  if (kind === 'cert') return !/PRIVATE KEY-----/.test(text) && text.includes('-----BEGIN CERTIFICATE-----');
  return ONE_KEY.test(text.trim());
}

const TEXTS: Record<Kind, Record<string, string>> = {
  cert: { A: SEED_CERT, B: RSA_LEAF, half: '-----BEGIN CERTIFICATE-----\nMIIBsDCC', junk: 'not a certificate', combined: COMBINED, keyPlusCert: SEED_KEY + SEED_CERT, encrypted: ENCRYPTED },
  key: { A: SEED_KEY, B: EC_PAIR.key, half: '-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBM', junk: 'not a key', combined: COMBINED, keyPlusCert: SEED_KEY + SEED_CERT, encrypted: ENCRYPTED },
};
const FILES: Record<Kind, Record<string, () => File>> = {
  cert: {
    ok: () => new File([RSA_LEAF], 'leaf.crt'),
    wrong: () => new File([SEED_KEY], 'tls.key'),
    combined: () => new File([COMBINED], 'both.pem'),
  },
  key: {
    ok: () => new File([EC_PAIR.key], 'ec.key'),
    wrong: () => new File([SEED_CERT], 'cert.pem'),
    combined: () => new File([SEED_KEY + SEED_CERT], 'both.pem'),
  },
};
const COMMON_FILES: Record<string, () => File> = {
  big: () => new File(['A'.repeat(70 * 1024)], 'big.pem'),
  binary: () => new File([new Uint8Array([0x30, 0x82, 0x01, 0x0a, 0x02, 0x01, 0x00, 0xff])], 'cert.crt'),
  noLabel: () => new File(['hello world'], 'notes.txt'),
};
/** Which files a box takes: only an acceptable one. */
const fileTaken = (name: string) => name === 'ok';
const fileText: Record<Kind, Record<string, string>> = { cert: { ok: RSA_LEAF }, key: { ok: EC_PAIR.key } };

interface Setup {
  get: () => string | undefined;
  scope: () => HTMLElement;
  fileAt: number;
  start: string | undefined;
  hidden?: string;
  dialog: boolean;
  text: string;
}

interface Place {
  name: string;
  kind: Kind;
  label: () => string;
  /** Renders it and opens the box; gives the field's starting value and the value the box cannot show, if any. */
  setup: () => Setup | Promise<Setup>;
}

const STORED: Obj = { id: 's1', snis: ['a.test'], cert: SEED_CERT };
let harness: ReturnType<typeof renderTab>;
const field = (path: (d: Obj) => unknown) => () => {
  const v = path(harness.value());
  return typeof v === 'string' ? v : undefined;
};

/** Pastes into a box (select all, then the text), with the box focused. */
function paste(box: HTMLTextAreaElement, text: string) {
  act(() => box.focus());
  fireEvent.change(box, { target: { value: text } });
}

async function openDialog(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: t('ssl.replace') }));
  return screen.findByRole('dialog', { name: t('ssl.replace.title') });
}

const PLACES: Place[] = [
  {
    name: 'new SSL certificate',
    kind: 'cert',
    label: () => t('ssl.pem.cert'),
    setup: () => {
      harness = renderTab('ssls', CertificateTab, { status: 1 }, sslIssues, { isNew: true });
      return { get: field((d) => d.cert), scope: () => document.body, fileAt: 0, start: undefined, dialog: false, text: '' };
    },
  },
  {
    name: 'new SSL certificate over a draft one holding a key',
    kind: 'cert',
    label: () => t('ssl.pem.cert'),
    setup: () => {
      harness = renderTab('ssls', CertificateTab, { status: 1, cert: COMBINED }, sslIssues, { isNew: true });
      return { get: field((d) => d.cert), scope: () => document.body, fileAt: 0, start: COMBINED, hidden: COMBINED, dialog: false, text: '' };
    },
  },
  {
    name: 'new SSL key, none entered',
    kind: 'key',
    label: () => t('ssl.pem.key'),
    setup: () => {
      harness = renderTab('ssls', CertificateTab, { status: 1, cert: SEED_CERT }, sslIssues, { isNew: true });
      return { get: field((d) => d.key), scope: () => document.body, fileAt: 1, start: undefined, dialog: false, text: '' };
    },
  },
  {
    name: 'new SSL key, one entered',
    kind: 'key',
    label: () => t('ssl.pem.key'),
    setup: () => {
      harness = renderTab('ssls', CertificateTab, { status: 1, cert: SEED_CERT, key: EC_PAIR.key }, sslIssues, { isNew: true });
      return { get: field((d) => d.key), scope: () => document.body, fileAt: 1, start: EC_PAIR.key, dialog: false, text: '' };
    },
  },
  {
    name: 'CA, none',
    kind: 'cert',
    label: () => t('ssl.client.ca'),
    setup: () => {
      harness = renderTab('ssls', ClientTab, { ...STORED, client: {} }, sslIssues, { original: itemOf('s1', STORED) });
      return { get: field((d) => (d.client as Obj | undefined)?.ca), scope: () => document.body, fileAt: 0, start: undefined, dialog: false, text: '' };
    },
  },
  {
    name: 'CA, stored',
    kind: 'cert',
    label: () => t('ssl.client.ca'),
    setup: () => {
      const draft = { ...STORED, client: { ca: SEED_CERT } };
      harness = renderTab('ssls', ClientTab, draft, sslIssues, { original: itemOf('s1', draft) });
      return { get: field((d) => (d.client as Obj | undefined)?.ca), scope: () => document.body, fileAt: 0, start: SEED_CERT, dialog: false, text: SEED_CERT };
    },
  },
  {
    name: 'CA, stored holding a key',
    kind: 'cert',
    label: () => t('ssl.client.ca'),
    setup: () => {
      const draft = { ...STORED, client: { ca: COMBINED } };
      harness = renderTab('ssls', ClientTab, draft, sslIssues, { original: itemOf('s1', draft) });
      fireEvent.click(screen.getByRole('button', { name: t('ssl.client.replaceCa') }));
      return { get: field((d) => (d.client as Obj | undefined)?.ca), scope: () => document.body, fileAt: 0, start: COMBINED, hidden: COMBINED, dialog: false, text: '' };
    },
  },
  {
    name: 'dialog certificate',
    kind: 'cert',
    label: () => t('ssl.pem.cert'),
    setup: async () => {
      harness = renderTab('ssls', CertificateTab, STORED, sslIssues, { original: itemOf('s1', STORED) });
      const dialog = await openDialog();
      paste(within(dialog).getByRole('textbox', { name: t('ssl.pem.key') }), SEED_KEY);
      return { get: field((d) => (d.key === SEED_KEY ? d.cert : undefined)), scope: () => dialog, fileAt: 0, start: undefined, dialog: true, text: '' };
    },
  },
  {
    name: 'dialog key',
    kind: 'key',
    label: () => t('ssl.pem.key'),
    setup: async () => {
      harness = renderTab('ssls', CertificateTab, STORED, sslIssues, { original: itemOf('s1', STORED) });
      const dialog = await openDialog();
      paste(within(dialog).getByRole('textbox', { name: t('ssl.pem.cert') }), RSA_LEAF);
      return { get: field((d) => (d.cert === RSA_LEAF ? d.key : undefined)), scope: () => dialog, fileAt: 1, start: undefined, dialog: true, text: '' };
    },
  },
];

const ACTIONS = ['A', 'B', 'half', 'junk', 'combined', 'keyPlusCert', 'encrypted', 'file:ok', 'file:big', 'file:binary', 'file:noLabel', 'file:combined', 'file:wrong', 'drop', 'empty', 'leave', 'return', 'save'] as const;

describe('every PEM box follows one rule (property, seeded)', () => {
  const SEEDS = 12;
  it(`${SEEDS} sequences of 10 steps in each of ${PLACES.length} places`, async () => {
    const ran: Record<string, number> = {};
    const places: Record<string, number> = {};
    for (const place of PLACES) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const r = prng(seed * 31 + place.name.length);
        const s = await place.setup();
        const { kind } = place;
        const label = place.label();
        // The reference: what the box shows, the field's value, the key that stood (a key box).
        let text = s.text;
        let value = s.start;
        let stood: string | undefined | null = null;
        const box = (): HTMLTextAreaElement | null => within(s.scope()).queryByRole<HTMLTextAreaElement>('textbox', { name: label });
        const heldNow = () => text.trim() !== '' && !takes(kind, text);
        const where = (step: string) => `${place.name}, seed ${seed}, ${step}`;
        const apply = () => within(s.scope()).queryByRole<HTMLButtonElement>('button', { name: t('ssl.replace.apply') });

        const check = (step: string) => {
          const w = where(step);
          // 1. No whole key block on the page unless the box holding it has focus (React also writes a
          // textarea's text into the markup, so a block in the markup must be the focused box's).
          const focused = document.activeElement;
          const focusedText = focused instanceof HTMLTextAreaElement ? focused.value : '';
          for (const block of document.body.innerHTML.match(new RegExp(WHOLE_KEY.source, 'g')) ?? []) {
            expect(focusedText.includes(block), `${w}: a whole private key on the page`).toBe(true);
          }
          for (const el of document.querySelectorAll('textarea')) if (el !== focused) expect(WHOLE_KEY.test(el.value), `${w}: a whole private key in a box`).toBe(false);
          // 2. Held, or the value is what the page says.
          const pending = harness.held().filter((m) => m.startsWith(`${label}:`));
          if (s.dialog) expect(apply()?.disabled, `${w}: the dialog's primary action`).toBe(heldNow() || value === undefined);
          else expect(pending.length > 0, `${w}: held`).toBe(heldNow());
          const el = box();
          if (el) expect(el.value, `${w}: the box's text`).toBe(text);
          else expect(text, `${w}: a closed box`).toBe('');
          if (!s.dialog) expect(s.get(), `${w}: the field's value`).toBe(value);
          if (kind === 'key') expect(screen.queryAllByText(t('ssl.key.entered')).length > 0 || within(s.scope()).queryByText(t('ssl.key.stays')) !== null, `${w}: "entered" ⇔ a key`).toBe(value !== undefined);
          if (kind === 'cert' && s.hidden !== undefined && text === '' && value === s.hidden) expect(within(s.scope()).getByText(t('ssl.box.hiddenStays')), w).toBeInTheDocument();
        };
        const setText = (next: string) => {
          if (kind === 'key') {
            if (stood === null) stood = value;
            if (takes('key', next)) {
              value = next;
              text = '';
              stood = null;
            } else {
              text = next;
              value = stood;
            }
          } else {
            text = next;
            if (next.trim() === '') value = s.hidden;
            else if (takes('cert', next)) value = next;
          }
        };
        const leave = () => {
          if (document.activeElement instanceof HTMLElement) act(() => (document.activeElement as HTMLElement).blur());
          if (kind === 'key' && (text.trim() === '' || takes('key', text))) {
            text = '';
            stood = null;
          } else if (!takes(kind, text)) text = text.replace(KEY_BLOCKS, t('ssl.pem.marker'));
        };
        /** The box's textarea, opening a closed key box first (Replace key). */
        const target = (): HTMLTextAreaElement => {
          const el = box();
          if (el) return el;
          fireEvent.click(within(s.scope()).getByRole('button', { name: t('ssl.key.replaceKey') }));
          if (stood === null) stood = value;
          return box() as HTMLTextAreaElement;
        };

        check('start');
        places[place.name] = (places[place.name] ?? 0) + 1;
        for (let step = 0; step < 10; step++) {
          const action = r.pick(ACTIONS);
          ran[action] = (ran[action] ?? 0) + 1;
          if (action in TEXTS[kind]) {
            const next = TEXTS[kind][action] as string;
            paste(target(), next);
            setText(next);
          } else if (action === 'drop') {
            const next = r.pick(Object.values(TEXTS[kind]));
            const el = target();
            act(() => el.focus());
            fireEvent.drop(el.closest('.ssl-pem') as HTMLElement, { dataTransfer: { files: [], getData: () => next } });
            setText(next);
          } else if (action === 'empty') {
            const el = box();
            if (el) {
              paste(el, '');
              setText('');
            }
          } else if (action === 'leave') {
            leave();
          } else if (action === 'return') {
            const el = target();
            act(() => el.focus());
          } else if (action === 'save') {
            const before = s.get();
            leave();
            if (heldNow()) {
              expect(harness.held().some((m) => m.startsWith(`${label}:`)) || s.dialog, `${where('save')}: refused`).toBe(true);
              expect(s.get(), `${where('save')}: nothing changed`).toBe(before);
            } else if (!s.dialog) expect(s.get(), `${where('save')}: the value saved`).toBe(value);
          } else {
            const name = action.slice('file:'.length);
            const make = FILES[kind][name] ?? COMMON_FILES[name];
            // A closed key box takes a file once it is opened (Replace key).
            target();
            const input = s.scope().querySelectorAll<HTMLInputElement>('input[type="file"]')[s.fileAt];
            if (!make || !input) throw new Error(`no ${action} for ${place.name}`);
            await act(async () => {
              fireEvent.change(input, { target: { files: [make()] } });
              await new Promise((done) => setTimeout(done, 5));
            });
            if (fileTaken(name)) {
              if (kind === 'key') {
                value = fileText.key.ok;
                text = '';
                  stood = null;
              } else setText(fileText.cert.ok as string);
            }
          }
          check(`step ${step} (${action})`);
        }
        // The dialog's result, when it can be applied, is the value the page described.
        if (s.dialog && apply() && !apply()?.disabled) {
          fireEvent.click(apply() as HTMLButtonElement);
          expect(s.get(), where('applied')).toBe(value);
        }
        cleanup();
      }
    }
    for (const action of ACTIONS) expect(ran[action] ?? 0, action).toBeGreaterThan(20);
    for (const place of PLACES) expect(places[place.name], place.name).toBe(SEEDS);
  }, 240_000);
});
