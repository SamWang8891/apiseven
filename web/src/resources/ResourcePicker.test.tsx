import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { Item } from '../api/types';
import { t } from '../i18n';
import { itemOf } from '../test/ctx';
import { LockProvider } from '../ui';
import { ResourcePicker } from './ResourcePicker';

const ITEMS: Item[] = [itemOf('u1', { name: 'web-pool' }), itemOf('u2', { name: 'api-backend', type: 'chash' }), itemOf('u3')];

function Harness({
  initial, locked = false, onChange, filter, loading, items = ITEMS,
}: { initial?: string; locked?: boolean; onChange?: (id: string | undefined) => void; filter?: (item: Item) => boolean; loading?: boolean; items?: Item[] }) {
  const [value, setValue] = useState(initial);
  return (
    <MemoryRouter>
      <LockProvider locked={locked}>
        <ResourcePicker
          kind="upstreams"
          items={items}
          loading={loading}
          value={value}
          label="Upstream"
          clearable
          filter={filter}
          onChange={(id) => {
            onChange?.(id);
            setValue(id);
          }}
        />
      </LockProvider>
    </MemoryRouter>
  );
}

describe('ResourcePicker', () => {
  it('lists the objects by name with the id beside, searchable, and links to the one chosen', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole('combobox', { name: 'Upstream' }));
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['web-poolu1', 'api-backendu2', 'u3']);
    await user.type(screen.getByRole('textbox', { name: t('ui.select.search') }), 'api');
    await user.click(screen.getByRole('option', { name: /api-backend/ }));
    expect(onChange).toHaveBeenLastCalledWith('u2');
    expect(screen.getByRole('link', { name: t('picker.open', { name: 'api-backend' }) })).toHaveAttribute('href', '/upstreams/u2');
  });

  it('keeps an id that matches nothing, flagged, until it is changed', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial="gone" onChange={onChange} />);
    const box = screen.getByRole('combobox', { name: 'Upstream' });
    expect(box).toHaveTextContent('gone');
    expect(box).toHaveAccessibleDescription(t('picker.notFound', { id: 'gone' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('ui.select.clear') }));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it('offers only the objects the filter lets through', async () => {
    const user = userEvent.setup();
    render(<Harness filter={(item) => item.value.type === 'chash'} />);
    await user.click(screen.getByRole('combobox', { name: 'Upstream' }));
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['api-backendu2']);
  });

  it('reads as a link to the object when locked', () => {
    render(<Harness initial="u1" locked />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'web-pool' })).toHaveAttribute('href', '/upstreams/u1');
    expect(screen.getByText('u1')).toBeInTheDocument();
  });

  it('says not found when locked on a dangling id', () => {
    render(<Harness initial="gone" locked />);
    expect(screen.getByText(t('picker.notFound', { id: 'gone' }))).toBeInTheDocument();
  });

  describe('while the list is loading', () => {
    it('shows the id with a quiet loading note, not "not found"', () => {
      render(<Harness initial="u1" items={[]} loading />);
      const box = screen.getByRole('combobox', { name: 'Upstream' });
      expect(box).toHaveTextContent('u1');
      expect(box).toHaveAccessibleDescription(t('picker.loading'));
      expect(screen.queryByText(t('picker.notFound', { id: 'u1' }))).not.toBeInTheDocument();
    });

    it('locked, the id and the note', () => {
      render(<Harness initial="u1" items={[]} loading locked />);
      expect(screen.getByText('u1')).toHaveClass('mono');
      expect(screen.getByText(t('picker.loading'))).toBeInTheDocument();
      expect(screen.queryByText(t('picker.notFound', { id: 'u1' }))).not.toBeInTheDocument();
    });

    it('once loaded (loading false), an id with no match is flagged', () => {
      render(<Harness initial="u9" loading={false} />);
      expect(screen.getByRole('combobox', { name: 'Upstream' })).toHaveAccessibleDescription(t('picker.notFound', { id: 'u9' }));
    });
  });
});
