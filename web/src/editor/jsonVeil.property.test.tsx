// Property test of the editing JSON tab's private-key notes (plugins/secrets.ts veilKeys / unveilKeys,
// editor/JsonTab.tsx): random sequences of edits to the JSON text of an SSL with a main key and two
// or three extra pairs, each with its own key: pairs swapped or removed in the text, a pair with a new
// key added from outside the tab, an unrelated field edited, Format, leaving the tab and coming back,
// the JSON broken and repaired. After every step: each certificate in the draft has the key it was
// entered with or none, no key in the draft is (or holds) a note, and no key text is in the page.
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

describe('the editing JSON tab never moves, loses or sends a private key (property, seeded)', () => {
  const SEEDS = 40;
  it(`${SEEDS} sequences of 8 steps over an SSL with a main key and 2–3 extra pairs`, async () => {
    const counts: Record<string, number> = {};
    let afterReorder = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = prng(seed);
      const pairs = 2 + r.int(2);
      // What each certificate was entered with.
      const truth = new Map<string, string>([[cert('main'), key('main')]]);
      const names = Array.from({ length: pairs }, (_, i) => `x${i}`);
      for (const n of names) truth.set(cert(n), key(n));
      const tab = mount({ snis: ['a.test'], cert: cert('main'), key: key('main'), certs: names.map(cert), keys: names.map(key) });
      await waitFor(() => expect(document.querySelector('.cm-content')).not.toBeNull());
      let added = 0;
      let reordered = false;

      const check = (step: string) => {
        const d = tab.draft();
        const where = `seed ${seed}, ${step}`;
        if (d.key !== undefined) expect(d.key, where).toBe(truth.get(d.cert as string));
        const certs = (Array.isArray(d.certs) ? d.certs : []) as string[];
        const keys = (Array.isArray(d.keys) ? d.keys : []) as unknown[];
        certs.forEach((c, i) => {
          const k = keys[i];
          if (k !== undefined && k !== null) expect(k, `${where}: key of pair ${i}`).toBe(truth.get(c));
        });
        for (const k of [d.key, ...keys]) if (typeof k === 'string') expect(k.includes(NOTE), `${where}: a note in the draft`).toBe(false);
        const html = document.body.innerHTML;
        for (const k of truth.values()) expect(html.includes(k.split('\n')[1] as string), `${where}: a key on the page`).toBe(false);
      };
      check('start');

      for (let step = 0; step < 8; step++) {
        const op = r.pick(['swap', 'remove', 'add', 'desc', 'format', 'leave', 'break'] as const);
        counts[op] = (counts[op] ?? 0) + 1;
        const shown = JSON.parse(tab.text()) as Obj;
        const certs = (shown.certs ?? []) as unknown[];
        const keys = (shown.keys ?? []) as unknown[];
        if (op === 'swap' && certs.length >= 2) {
          const i = r.int(certs.length);
          const j = (i + 1) % certs.length;
          [certs[i], certs[j]] = [certs[j], certs[i]];
          [keys[i], keys[j]] = [keys[j], keys[i]];
          tab.type(JSON.stringify({ ...shown, certs, keys }, null, 2));
          reordered = true;
        } else if (op === 'remove' && certs.length >= 1) {
          const i = r.int(certs.length);
          certs.splice(i, 1);
          keys.splice(i, 1);
          tab.type(JSON.stringify({ ...shown, certs, keys }, null, 2));
          reordered = true;
        } else if (op === 'add') {
          // From another tab (the dialog): a new pair goes into the draft from outside.
          const n = `new${seed}-${++added}`;
          truth.set(cert(n), key(n));
          const d = tab.draft();
          const dc = (Array.isArray(d.certs) ? d.certs : []) as unknown[];
          const dk = (Array.isArray(d.keys) ? d.keys : dc.map(() => null)) as unknown[];
          tab.outside({ ...d, certs: [...dc, cert(n)], keys: [...dk, key(n)] });
        } else if (op === 'desc') {
          if (reordered) afterReorder++;
          tab.type(JSON.stringify({ ...shown, desc: `d${step}` }, null, 2));
        } else if (op === 'format') {
          tab.format();
        } else if (op === 'leave') {
          await tab.remount();
        } else if (op === 'break') {
          const before = tab.text();
          tab.type(`${before}{`);
          expect(tab.held().length, `seed ${seed}: broken JSON holds`).toBe(1);
          check(`step ${step} (${op}, broken)`);
          tab.type(before);
        }
        expect(tab.held(), `seed ${seed}, step ${step} (${op})`).toEqual([]);
        check(`step ${step} (${op})`);
      }
      cleanup();
    }
    // Every kind of step ran, and edits after a reorder or removal happened often.
    for (const op of ['swap', 'remove', 'add', 'desc', 'format', 'leave', 'break']) expect(counts[op] ?? 0, op).toBeGreaterThan(10);
    expect(afterReorder).toBeGreaterThan(20);
  }, 120_000);
});
