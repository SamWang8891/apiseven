// The columns of a consumer's credentials table (its Credentials tab).
import { cleanup, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Item } from '../../api/types';
import { t } from '../../i18n';
import { ctxOf, itemOf } from '../../test/ctx';
import { renderWithProviders } from '../../test/providers';
import type { ColumnDef } from '../registry';
import { credentialColumns } from './columns';

function col(id: string): ColumnDef {
  const column = credentialColumns.find((c) => c.id === id);
  if (!column) throw new Error(`no column ${id}`);
  return column;
}

const KEY = itemOf('alice-key', { name: 'alice-key', desc: 'CI', labels: { env: 'ci' }, plugins: { 'key-auth': { key: 'alice-dev-key' } }, update_time: 1700000000 });
const OFF = itemOf('off', { plugins: { 'basic-auth': { username: 'u', password: 'pw', _meta: { disable: true } } } });
const NONE = itemOf('none', {});

function cell(id: string, item: Item) {
  cleanup();
  renderWithProviders(<div data-testid="cell">{col(id).cell?.(item, ctxOf())}</div>, { counts: {} });
  return screen.getByTestId('cell');
}

describe('credential columns', () => {
  it('id, name, plugin and updated by default; desc and labels on demand', () => {
    expect(credentialColumns.map((c) => c.id)).toEqual(['id', 'name', 'plugin', 'updated', 'desc', 'labels']);
    expect(credentialColumns.filter((c) => c.defaultVisible).map((c) => c.id)).toEqual(['id', 'name', 'plugin', 'updated']);
    for (const column of credentialColumns) expect(column.width, column.id).toBeGreaterThan(0);
  });

  it('id in monospace; name falls back to the id (the table links it to the editor)', () => {
    expect(col('id').mono).toBe(true);
    expect(cell('id', KEY)).toHaveTextContent('alice-key');
    expect(col('name').accessor(NONE, ctxOf())).toBe('none');
    expect('cell' in col('name')).toBe(false);
  });

  it('plugin: the auth plugin by name, never its key; none says so', () => {
    expect(col('plugin').accessor(KEY, ctxOf())).toEqual(['key-auth']);
    const el = cell('plugin', KEY);
    expect(el).toHaveTextContent('key-auth');
    expect(el.textContent).not.toContain('alice-dev-key');
    expect(el).not.toHaveTextContent(t('cell.plugin.stillSignsIn'));
    expect(cell('plugin', NONE)).toHaveTextContent(t('ui.empty'));
  });

  it('an auth plugin stored as off still signs in (consumer.lua plugin_consumer): the chip says so in danger, never "off"', () => {
    const el = cell('plugin', OFF);
    expect(el).toHaveTextContent(`basic-auth${t('cell.plugin.stillSignsIn')}`);
    expect(el).not.toHaveTextContent(t('cell.plugin.off'));
    expect(el.querySelector('.cell-plugin__danger')).not.toBeNull();
    expect(el.querySelector('.cell-plugin')).toHaveAttribute('title', `basic-auth: ${t('cell.plugin.stillSignsInWhy')}`);
  });
});
