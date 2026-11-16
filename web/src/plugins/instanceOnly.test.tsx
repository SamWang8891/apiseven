// Final wave D5: a plugin APISIX runs for the whole instance (scope.ts runsForInstance: ai, inspect,
// server-info, …) does nothing as an entry of an object's plugins, on or off. Its card says so instead
// of offering an enable switch, and the picker does not offer it.
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { renderPluginsTab } from '../test/plugins';

const loaded = () => waitFor(() => expect(screen.queryByText(t('pl.loading'))).not.toBeInTheDocument());

describe('an entry of a plugin run for the whole instance', () => {
  it('has no enable switch and is not marked off; its badge and note say it has no effect here; its run options have no disable', async () => {
    const { user } = renderPluginsTab({ scope: 'route', value: { inspect: { _meta: { disable: true } }, ai: {}, 'limit-count': { count: 1, time_window: 60 } }, validate: false });
    await loaded();
    for (const name of ['inspect', 'ai']) {
      const card = screen.getByRole('group', { name });
      expect(within(card).queryByRole('switch', { name: t('pl.card.enable', { name }) })).toBeNull();
      expect(within(card).getByText(t('pl.card.instance'))).toBeInTheDocument();
      expect(card).not.toHaveClass('pl-card--off');
    }
    // An ordinary plugin keeps its switch.
    expect(screen.getByRole('switch', { name: t('pl.card.enable', { name: 'limit-count' }) })).toBeInTheDocument();

    const card = screen.getByRole('group', { name: 'inspect' });
    await user.click(within(card).getByRole('button', { name: 'inspect' }));
    expect(within(card).getByText(t('pl.card.instanceNote', { name: 'inspect' }))).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: /^Run options/ }));
    expect(within(card).queryByRole('switch', { name: /disable/i })).toBeNull();
  });

  it('the picker does not offer one', async () => {
    const { user } = renderPluginsTab({ scope: 'global_rule', value: {}, validate: false });
    await loaded();
    await user.click(screen.getByRole('button', { name: t('pl.add') }));
    const dialog = await screen.findByRole('dialog', { name: t('pl.picker.title') });
    const search = within(dialog).getByRole('combobox', { name: t('pl.picker.search') });
    await user.type(search, 'inspect');
    expect(dialog.querySelector('[data-plugin="inspect"]')).toBeNull();
    await user.clear(search);
    expect(dialog.querySelector('[data-plugin="ai"]')).toBeNull();
    expect(dialog.querySelector('[data-plugin="ai-proxy"]')).not.toBeNull();
    expect(within(dialog).getByRole('option', { name: /^limit-count\b/ })).toBeInTheDocument();
  });
});
