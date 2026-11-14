// Every plugin of the 3.20 fixture (http and stream) in a card, in every scope that offers it: the
// tab renders them all collapsed, and each one opens to its form (and _meta section) without throwing.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Obj } from '../api/types';
import { t } from '../i18n';
import { pluginFixture } from '../test/pluginFixture';
import { renderPluginsTab } from '../test/plugins';
import { pluginsAvailable, type Scope } from './scope';

const SCOPES: Scope[] = ['route', 'service', 'consumer', 'consumer_group', 'global_rule', 'plugin_config', 'credential', 'stream_route'];

describe.each(SCOPES)('every plugin available in a %s', (scope) => {
  it('renders in a card that opens to its form', async () => {
    const all = scope === 'stream_route' ? pluginFixture().stream : pluginFixture().http;
    const names = pluginsAvailable(all, scope);
    const value: Record<string, Obj> = Object.fromEntries(names.map((name) => [name, {}]));
    const { container } = renderPluginsTab({ scope, value, validate: false });
    await screen.findByRole('group', { name: names[0] });
    await waitFor(() => expect(screen.queryByText(t('pl.loading'))).not.toBeInTheDocument());
    // DOM queries in the loop: role queries over a hundred cards would dominate the run time.
    const cards = [...container.querySelectorAll<HTMLElement>('.pl-card')];
    expect(cards.map((c) => c.querySelector('.pl-card__name')?.textContent)).toEqual(names);
    for (const card of cards) {
      const name = card.querySelector('.pl-card__name')?.textContent ?? '';
      const toggle = card.querySelector<HTMLButtonElement>('.pl-card__toggle');
      if (!toggle) throw new Error(`no toggle for ${name}`);
      fireEvent.click(toggle);
      expect(toggle.getAttribute('aria-expanded'), name).toBe('true');
      expect(card.querySelector('.sf'), name).not.toBeNull();
      const meta = card.querySelector<HTMLButtonElement>('.pl-metabox__toggle');
      if (!meta) throw new Error(`no _meta section for ${name}`);
      fireEvent.click(meta);
      expect(card.querySelector('[id$="-meta-priority"]'), name).not.toBeNull();
      fireEvent.click(toggle);
    }
  }, 60_000);
});
