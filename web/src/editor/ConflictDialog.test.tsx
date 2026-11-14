import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { ConflictDialog } from './ConflictDialog';

const noop = () => {};

function show(loaded: Record<string, unknown>, theirs: Record<string, unknown>) {
  render(<ConflictDialog kind="Route" name="web" loaded={loaded} theirs={theirs} onOverwrite={noop} onReload={noop} onCancel={noop} />);
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

  it('offers overwrite, reload and cancel', () => {
    const dialog = show({ a: 1 }, { a: 2 });
    for (const name of [t('editor.conflict.overwrite'), t('editor.conflict.reload'), t('ui.cancel')]) {
      expect(within(dialog).getAllByRole('button', { name }).length).toBeGreaterThan(0);
    }
  });
});
