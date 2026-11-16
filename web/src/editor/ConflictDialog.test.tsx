import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Kind } from '../api/types';
import { t } from '../i18n';
import { MASK_CHANGED } from '../plugins/secrets';
import { MASK } from '../schema/secrets';
import { pluginFixture } from '../test/pluginFixture';
import { ConflictDialog } from './ConflictDialog';

const noop = () => {};

function show(loaded: Record<string, unknown>, theirs: Record<string, unknown>, resource: Kind = 'routes') {
  render(<ConflictDialog kind="Route" name="web" resource={resource} plugins={pluginFixture().http} loaded={loaded} theirs={theirs} onOverwrite={noop} onReload={noop} onCancel={noop} />);
  return screen.getByRole('dialog', { name: t('editor.conflict.title', { kind: 'Route', name: 'web' }) });
}

const marked = (dialog: HTMLElement, tag: 'ins' | 'del') => [...dialog.querySelectorAll(`${tag} .ed-diff__text`)].map((el) => el.textContent?.trim());

describe('ConflictDialog', () => {
  it('ignores key order (APISIX reorders keys between reads): only real changes are marked', () => {
    const dialog = show(
      { id: 'r1', plugins: { cors: { allow_methods: 'GET', allow_origins: '*' } }, priority: 10, uri: '/a' },
      { uri: '/a', priority: 5, plugins: { cors: { allow_origins: '*', allow_methods: 'GET' } }, id: 'r1' },
    );
    expect(marked(dialog, 'del')).toEqual(['"priority": 10,']);
    expect(marked(dialog, 'ins')).toEqual(['"priority": 5,']);
  });

  it('says so when only the timestamps differ', () => {
    const dialog = show({ id: 'r1', uri: '/a', update_time: 1 }, { uri: '/a', id: 'r1', update_time: 2 });
    expect(within(dialog).getByText(t('editor.conflict.timeOnly'))).toBeInTheDocument();
    expect(dialog.querySelectorAll('ins, del')).toHaveLength(0);
  });

  // Final wave C3: 140,000 short labels are a legal route (no entry-count limit, under the 1.5 MiB
  // request limit); the dialog still opens with its choices, the unchanged lines folded.
  it('a route with 140,000 labels: the change is shown, the rest folded, and the choices offered', () => {
    const labels = Object.fromEntries(Array.from({ length: 140_000 }, (_, i) => [`k${i}`, 'v']));
    const dialog = show({ id: 'r1', host: 'a.example', labels, uri: '/' }, { id: 'r1', host: 'b.example', labels, uri: '/' });
    expect(marked(dialog, 'del')).toEqual(['"host": "a.example",']);
    expect(marked(dialog, 'ins')).toEqual(['"host": "b.example",']);
    expect(dialog.querySelectorAll('.ed-diff__line').length).toBeLessThan(20);
    for (const name of [t('editor.conflict.overwrite'), t('editor.conflict.reload'), t('ui.cancel')]) {
      expect(within(dialog).getAllByRole('button', { name }).length).toBeGreaterThan(0);
    }
  });

  // Fix round 1, R2.2: changed at both ends, the labels between them cannot be aligned (too many
  // lines to compare): a summary instead of 280,000 removed and added lines.
  it('a route with 140,000 labels changed at both ends: a summary naming the fields that differ, and the choices', () => {
    const labels = Object.fromEntries(Array.from({ length: 140_000 }, (_, i) => [`k${i}`, 'v']));
    const dialog = show({ id: 'r1', host: 'a.example', labels, uri: '/a' }, { id: 'r1', host: 'b.example', labels, uri: '/b' });
    expect(within(dialog).getByText(t('editor.conflict.tooLarge', { lines: '140,007', fields: 'host, uri' }))).toBeInTheDocument();
    expect(dialog.querySelectorAll('.ed-diff__line').length).toBe(0);
    for (const name of [t('editor.conflict.overwrite'), t('editor.conflict.reload'), t('ui.cancel')]) {
      expect(within(dialog).getAllByRole('button', { name }).length).toBeGreaterThan(0);
    }
  });

  it('offers overwrite, reload and cancel', () => {
    const dialog = show({ a: 1 }, { a: 2 });
    for (const name of [t('editor.conflict.overwrite'), t('editor.conflict.reload'), t('ui.cancel')]) {
      expect(within(dialog).getAllByRole('button', { name }).length).toBeGreaterThan(0);
    }
  });

  describe('secrets', () => {
    const mine = { id: 'c1', name: 'ci', plugins: { 'key-auth': { key: 'my-key-1' } } };
    const theirs = { id: 'c1', name: 'ci', plugins: { 'key-auth': { key: 'their-key-2' } } };

    it('neither key is in the page until "Show secrets"; a key that differs still reads as changed', async () => {
      const dialog = show(mine, theirs, 'credentials');
      expect(document.body.innerHTML).not.toContain('my-key-1');
      expect(document.body.innerHTML).not.toContain('their-key-2');
      expect(marked(dialog, 'del')).toEqual([`"key": "${MASK}"`]);
      expect(marked(dialog, 'ins')).toEqual([`"key": "${MASK_CHANGED}"`]);
      await userEvent.click(within(dialog).getByRole('button', { name: t('pl.card.secrets.show') }));
      expect(marked(dialog, 'del')).toEqual(['"key": "my-key-1"']);
      expect(marked(dialog, 'ins')).toEqual(['"key": "their-key-2"']);
    });

    it('an equal key is masked and not marked; with nothing secret, no toggle', () => {
      const dialog = show(mine, { ...mine, name: 'other' }, 'credentials');
      expect(document.body.innerHTML).not.toContain('my-key-1');
      expect(marked(dialog, 'ins')).toEqual(['"name": "other",']);
      expect(within(dialog).queryByRole('button', { name: t('pl.card.secrets.show') })).toBeInTheDocument();
      cleanup();
      const plain = show({ a: 1 }, { a: 2 });
      expect(within(plain).queryByRole('button', { name: t('pl.card.secrets.show') })).not.toBeInTheDocument();
    });

    it("an upstream's client_key is never shown, revealed or not; a different one reads as changed", () => {
      const dialog = show({ tls: { client_cert: 'C', client_key: 'AES-1' } }, { tls: { client_cert: 'C', client_key: 'AES-2' } }, 'upstreams');
      expect(document.body.innerHTML).not.toMatch(/AES-[12]/);
      expect(marked(dialog, 'ins')).toEqual([`"client_key": "${MASK_CHANGED}"`]);
      expect(within(dialog).queryByRole('button', { name: t('pl.card.secrets.show') })).not.toBeInTheDocument();
    });
  });
});
