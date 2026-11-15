import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { itemOf } from '../test/ctx';
import { renderWithProviders } from '../test/providers';
import { EditorHeader, type EditorHeaderProps } from './EditorHeader';

// Fix round 1, F1: the meta line under the title never wraps; what can be long (the owner, the
// creation time, a copy's note) gives way with an ellipsis and a title, and "Unsaved changes" never.

const LONG = 'x'.repeat(200);
const noop = () => {};

function header(p: Partial<EditorHeaderProps>) {
  const props: EditorHeaderProps = {
    title: 'web',
    back: { to: '/routes', label: 'Back to Routes' },
    locked: false,
    isNew: false,
    dirty: true,
    readOnly: false,
    saving: false,
    saveBlocked: false,
    editRef: null,
    onEdit: noop,
    onSave: noop,
    onDiscard: noop,
    onViewJson: noop,
    onDelete: noop,
    ...p,
  };
  return renderWithProviders(<EditorHeader {...props} />, { counts: {} });
}

/** The meta line's items, in order: [text, shrinks]. */
const items = () =>
  [...document.querySelectorAll<HTMLElement>('.ed-meta > .ed-meta__item')].map((el) => [el.textContent, el.classList.contains('ed-meta__item--shrink')]);

describe('the editor meta line', () => {
  it('a credential: the owner shrinks, "Unsaved changes" comes last and never shrinks', () => {
    header({ owner: { kind: 'Consumer', name: LONG, to: '/consumers/x' }, original: itemOf('k1', { create_time: 1700000000, update_time: 1700000100 }) });
    const line = items();
    expect(line[0]).toEqual([`Consumer ${LONG}`, true]);
    expect(line.at(-1)).toEqual([t('editor.unsaved'), false]);
    // Updated never shrinks; the creation time does.
    expect(line.map(([, shrinks]) => shrinks)).toEqual([true, false, true, false]);
  });

  it('a copy: its note shrinks before the mark, which stays last', () => {
    header({ isNew: true, note: t('editor.copyOf', { kind: 'Route', name: LONG }) });
    expect(items()).toEqual([
      [t('editor.copyOf', { kind: 'Route', name: LONG }), true],
      [t('editor.unsaved'), false],
    ]);
  });

  it('a cut-off note or owner says all of itself in a title (only then)', () => {
    header({ isNew: true, note: t('editor.copyOf', { kind: 'Route', name: LONG }), owner: { kind: 'Consumer', name: 'jo', to: '/consumers/jo' } });
    const [owner, note] = [...document.querySelectorAll<HTMLElement>('.ed-meta__item--shrink')] as [HTMLElement, HTMLElement];
    fireEvent.pointerEnter(owner);
    expect(owner).not.toHaveAttribute('title');
    Object.defineProperty(note, 'scrollWidth', { configurable: true, value: 900 });
    Object.defineProperty(note, 'clientWidth', { configurable: true, value: 300 });
    fireEvent.pointerEnter(note);
    expect(note).toHaveAttribute('title', t('editor.copyOf', { kind: 'Route', name: LONG }));
    expect(screen.getByText(t('editor.unsaved'))).toBeInTheDocument();
  });
});
