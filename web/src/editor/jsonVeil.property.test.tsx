// Property test of the editing JSON tab's private-key notes (plugins/secrets.ts veilKeys / unveilKeys,
// editor/JsonTab.tsx): random sequences of edits to the JSON text of an SSL with a main key and two
// or three extra pairs, each with its own key: pairs swapped or removed in the text, a pair with a new
// key added from outside the tab, an unrelated field edited, Format, leaving the tab and coming back,
// the JSON broken and repaired. After every step: the draft holds exactly the certificates it should,
// in order (a model of the edits, kept apart from the text), each with the key it was entered with or
// none; no key in the draft is (or holds) a note; and no key text is in the page.
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { useEffect, useState } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Obj } from '../api/types';
import { t } from '../i18n';
import { ctxOf } from '../test/ctx';
import { pluginReplies } from '../test/plugins';
import { prng } from '../test/prng';
import { renderWithProviders } from '../test/providers';
import { LockProvider, PendingProvider, type PendingEntry } from '../ui';
import { JsonTab } from './JsonTab';

beforeAll(async () => {
  await import('../ui/codemirror/CodeEditorImpl');
});

const cert = (name: string) => `-----BEGIN CERTIFICATE-----\nCERT-${name}\n-----END CERTIFICATE-----\n`;
const key = (name: string) => `-----BEGIN PRIVATE KEY-----\nKEYTEXT-${name}-0123456789abcdef0123456789abcdef0123456789\n-----END PRIVATE KEY-----\n`;

function mount(initial: Obj) {
  let current = initial;
  let held: PendingEntry[] = [];
  const control: { set?: (d: Obj) => void; remount?: () => void } = {};
  function Harness() {
    const [draft, setDraft] = useState(initial);
    const [mounts, setMounts] = useState(0);
    useEffect(() => {
      control.set = (d) => {
        current = d;
        setDraft(d);
      };
      control.remount = () => setMounts((n) => n + 1);
    }, []);
    return (
      <PendingProvider onChange={(entries) => (held = entries)}>
        <LockProvider locked={false}>
          <JsonTab
            key={mounts}
            draft={draft}
            setDraft={(next) => {
              current = next;
              setDraft(next);
            }}
            kind="ssls"
            isNew={false}
            ctx={ctxOf()}
            issues={[]}
            saveAttempts={0}
          />
        </LockProvider>
      </PendingProvider>
    );
  }
  renderWithProviders(<Harness />, { counts: {}, replies: pluginReplies() });
  const view = () => EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement) as EditorView;
  return {
    draft: () => current,
    held: () => held.map((e) => e.message),
    text: () => view().state.doc.toString(),
    type: (text: string) => act(() => view().dispatch({ changes: { from: 0, to: view().state.doc.length, insert: text } })),
    outside: (d: Obj) => act(() => control.set?.(d)),
    remount: async () => {
      act(() => control.remount?.());
      await waitFor(() => expect(document.querySelector('.cm-content')).not.toBeNull());
    },
    format: () => fireEvent.click(screen.getByRole('button', { name: t('editor.json.format') })),
  };
}

const NOTE = '••••';

/** The JSON text in one of several forms, so Format is not always a no-op: pretty, compact, 4-space, keys reordered. */
function written(o: Obj, r: ReturnType<typeof prng>): string {
  const form = r.int(5);
  if (form === 0) return JSON.stringify(o, null, 2);
  if (form === 1) return JSON.stringify(o);
  if (form === 2) return JSON.stringify(o, null, 4);
  const keys = Object.keys(o);
  const reordered = Object.fromEntries([...keys.slice(1), keys[0] as string].map((k) => [k, o[k]]));
  return form === 3 ? JSON.stringify(reordered, null, 2) : JSON.stringify(reordered);
}

describe('the editing JSON tab never moves, loses or sends a private key (property, seeded)', () => {
  const SEEDS = 60;
  it(`${SEEDS} sequences of 10 steps over an SSL with a main key and 2–3 extra pairs`, async () => {
    // Steps that ran (not picks): a swap needs two pairs, a removal one, a Format an enabled button that changed the text.
    const ran: Record<string, number> = {};
    const count = (op: string) => (ran[op] = (ran[op] ?? 0) + 1);
    let afterReorder = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = prng(seed);
      const pairs = 2 + r.int(2);
      // What each certificate was entered with; the certificates added without a key.
      const truth = new Map<string, string>([[cert('main'), key('main')]]);
      const keyless = new Set<string>();
      const names = Array.from({ length: pairs }, (_, i) => `x${i}`);
      for (const n of names) truth.set(cert(n), key(n));
      // The extra certificates that should be in the draft, in order: each edit below applied to this list too.
      const expected = names.map(cert);
      const tab = mount({ snis: ['a.test'], cert: cert('main'), key: key('main'), certs: names.map(cert), keys: names.map(key) });
      await waitFor(() => expect(document.querySelector('.cm-content')).not.toBeNull());
      let added = 0;
      let reordered = false;

      const check = (step: string) => {
        const d = tab.draft();
        const where = `seed ${seed}, ${step}`;
        expect(d.key, `${where}: the main key`).toBe(key('main'));
        const certs = (Array.isArray(d.certs) ? d.certs : []) as string[];
        const keys = (Array.isArray(d.keys) ? d.keys : []) as unknown[];
        expect(certs, `${where}: the certificates present`).toEqual(expected);
        // Each certificate has exactly the key it was entered with; none only when it was added without one.
        certs.forEach((c, i) => {
          if (keyless.has(c)) expect(keys[i] ?? null, `${where}: pair ${i} had no key`).toBeNull();
          else expect(keys[i], `${where}: key of pair ${i}`).toBe(truth.get(c));
        });
        expect(keys.length, `${where}: one key place per certificate`).toBe(certs.length);
        for (const k of [d.key, ...keys]) if (typeof k === 'string') expect(k.includes(NOTE), `${where}: a note in the draft`).toBe(false);
        const html = document.body.innerHTML;
        for (const k of truth.values()) expect(html.includes(k.split('\n')[1] as string), `${where}: a key on the page`).toBe(false);
      };
      check('start');

      for (let step = 0; step < 10; step++) {
        // Format is picked twice as often: it runs only when the text is not already formatted.
        const op = r.pick(['swap', 'remove', 'add', 'desc', 'format', 'format', 'leave', 'break'] as const);
        const shown = JSON.parse(tab.text()) as Obj;
        const certs = (shown.certs ?? []) as unknown[];
        const keys = (shown.keys ?? []) as unknown[];
        if (op === 'swap' && certs.length >= 2) {
          const i = r.int(certs.length);
          const j = (i + 1) % certs.length;
          [certs[i], certs[j]] = [certs[j], certs[i]];
          [keys[i], keys[j]] = [keys[j], keys[i]];
          [expected[i], expected[j]] = [expected[j] as string, expected[i] as string];
          tab.type(written({ ...shown, certs, keys }, r));
          reordered = true;
          count(op);
        } else if (op === 'remove' && certs.length >= 1) {
          const i = r.int(certs.length);
          certs.splice(i, 1);
          keys.splice(i, 1);
          expected.splice(i, 1);
          tab.type(written({ ...shown, certs, keys }, r));
          reordered = true;
          count(op);
        } else if (op === 'add') {
          // From another tab: a new pair goes into the draft from outside, sometimes without its key yet.
          const n = `new${seed}-${++added}`;
          const withKey = r.int(3) > 0;
          if (withKey) truth.set(cert(n), key(n));
          else keyless.add(cert(n));
          const d = tab.draft();
          const dc = (Array.isArray(d.certs) ? d.certs : []) as unknown[];
          const dk = (Array.isArray(d.keys) ? d.keys : dc.map(() => null)) as unknown[];
          tab.outside({ ...d, certs: [...dc, cert(n)], keys: [...dk, withKey ? key(n) : null] });
          expected.push(cert(n));
          count(withKey ? 'add' : 'add without a key');
        } else if (op === 'desc') {
          if (reordered) afterReorder++;
          tab.type(written({ ...shown, desc: `d${step}` }, r));
          count(op);
        } else if (op === 'format') {
          const button = screen.getByRole('button', { name: t('editor.json.format') });
          if (!button.hasAttribute('disabled')) {
            const before = tab.text();
            tab.format();
            expect(tab.text(), `seed ${seed}: Format changed the text`).not.toBe(before);
            count(op);
          }
        } else if (op === 'leave') {
          await tab.remount();
          count(op);
        } else if (op === 'break') {
          const before = tab.text();
          tab.type(`${before}{`);
          expect(tab.held().length, `seed ${seed}: broken JSON holds`).toBe(1);
          check(`step ${step} (${op}, broken)`);
          tab.type(before);
          count(op);
        }
        expect(tab.held(), `seed ${seed}, step ${step} (${op})`).toEqual([]);
        check(`step ${step} (${op})`);
      }
      cleanup();
    }
    // Every kind of step ran, Formats that changed the text included, and edits after a reorder or removal often.
    for (const op of ['swap', 'remove', 'add', 'add without a key', 'desc', 'format', 'leave', 'break']) expect(ran[op] ?? 0, op).toBeGreaterThan(op === 'add without a key' ? 10 : 20);
    expect(afterReorder).toBeGreaterThan(20);
  }, 180_000);
});
